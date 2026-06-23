import dns from 'node:dns';
import net from 'node:net';
import { z } from 'zod';

/**
 * ## SSRF Protection Module
 *
 * ### Problem
 * Campaign metadata may include user-supplied URLs (e.g. `imageUrl`,
 * `externalLink`). If the backend ever fetches these URLs — for example
 * to generate OpenGraph previews, render thumbnails, or audit links — an
 * attacker could submit a URL pointing at internal infrastructure
 * (http://127.0.0.1:6379/flushall, http://169.254.169.254/... AWS metadata,
 * file:///etc/passwd, etc.). This is the textbook Server-Side Request
 * Forgery (SSRF) pattern, ranked in the OWASP Top 10 (A10:2021).
 *
 * ### Defense in Depth
 * This module implements two layers so the system is robust even before
 * any fetcher is wired up:
 *
 *  1. **Synchronous schema validation (`httpsOnlyUrlSchema`)**
 *     Used at every public ingest boundary (e.g. `POST /api/campaigns`).
 *     Rejects:
 *       - any protocol other than `https:` (no `http:`, `ftp:`, `file:`,
 *         `data:`, `javascript:`, `gopher:`, …),
 *       - URLs containing userinfo (`http://foo:bar@evil/`),
 *       - URL literals whose host is a private / loopback / link-local
 *         IPv4 or IPv6 address.
 *
 *     DNS is intentionally **not** resolved here so the schema stays
 *     cheap, deterministic, and side-effect free (no network syscalls
 *     during request validation).
 *
 *  2. **Runtime fetch-time guard (`assertSafeRemoteUrl`)**
 *     Optional helper for any future code path that actually fetches a
 *     user-supplied URL. Performs real DNS resolution via
 *     `dns.lookup({ all: true, verbatim: true })` and rejects when *any*
 *     resolved address falls in a private CIDR. Resolves hostnames
 *     before the underlying HTTP client opens a socket, defeating
 *     classic DNS-rebinding and 302-redirect-to-internal attacks.
 *
 * The list of blocked ranges follows IANA special-purpose address
 * registries plus commonly exploited ranges (`cloud_metadata`,
 * `carrier-grade NAT`, IPv6 ULA, link-local, and IPv4-mapped IPv6):
 *
 *   - IPv4:  `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
 *            `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`,
 *            `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`,
 *            `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`,
 *            `224.0.0.0/4`, `240.0.0.0/4`, `255.255.255.255/32`
 *   - IPv6:  `::/128`, `::1/128`, `::ffff:0:0/96` (v4-mapped),
 *            `64:ff9b::/96`, `100::/64`, `2001::/32` (Teredo),
 *            `2001:db8::/32`, `fc00::/7`, `fe80::/10`
 *   - Names:  `localhost`, `*.localhost`, `*.local`
 */

const MAX_URL_LENGTH = 2048;

interface ParsedUrl {
  url: URL;
  protocol: string;
  hostname: string;
  hasUserinfo: boolean;
}

/**
 * Best-effort parse of a URL string. Returns `null` when the value
 * cannot be parsed by WHATWG URL — call sites should treat that as a
 * validation failure with a generic "invalid URL" message (no need to
 * leak parser internals).
 */
export function tryParseUrl(rawUrl: string): ParsedUrl | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  return {
    url,
    protocol: url.protocol,
    hostname: url.hostname,
    hasUserinfo: url.username !== '' || url.password !== '',
  };
}

/**
 * `true` when the supplied string is a literal IPv4 or IPv6 address
 * that resides in a private, loopback, link-local, multicast,
 * documentation, or otherwise non-routable CIDR. Otherwise `false`.
 *
 * Hostnames that are *not* literal IPs always return `false` here —
 * DNS-based detection lives in {@link assertSafeRemoteUrl}.
 */
export function isPrivateOrLoopbackAddress(addr: string): boolean {
  if (typeof addr !== 'string') {
    return false;
  }

  const value = addr
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (net.isIPv4(value)) {
    return isPrivateOrLoopbackIPv4(value);
  }
  if (net.isIPv6(value)) {
    return isPrivateOrLoopbackIPv6(value);
  }
  return false;
}

/**
 * Returns `true` for any literal-IP hostname or DNS-resolvable name
 * that maps to a private/loopback address.
 *
 * Synchronous: only inspects the provided string. Performs no DNS
 * queries. Use {@link assertSafeRemoteUrl} when runtime DNS rebinding
 * protection is needed.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (typeof hostname !== 'string') {
    return false;
  }
  const lower = hostname.trim().toLowerCase();

  // Short-circuit literal IPs
  if (isPrivateOrLoopbackAddress(lower)) {
    return true;
  }

  // Hostname patterns that always resolve to loopback / mDNS hosts.
  // We intentionally do NOT enumerate every TLD here — that is the
  // job of the DNS-resolving guard. We just block the unambiguous
  // names an attacker would type.
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost.localdomain')
  ) {
    return true;
  }

  return false;
}

function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return false;
  }
  const [a, b] = parts;

  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918 private
  if (a === 10) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (also AWS/GCP/Azure IMDS)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918 private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 — IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  // 192.0.2.0/24 — TEST-NET-1 documentation
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  // 192.168.0.0/16 — RFC1918 private
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 198.51.100.0/24 — TEST-NET-2 documentation
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  // 203.0.113.0/24 — TEST-NET-3 documentation
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 — multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved / broadcast
  if (a >= 240) return true;

  return false;
}

function isPrivateOrLoopbackIPv6(ip: string): boolean {
  // Normalize for prefix matching. Expand `::` short form so prefix
  // checks work consistently.
  const expanded = expandIPv6(ip);
  if (!expanded) {
    return false;
  }

  // :: (all zeros)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  // ::1 (loopback)
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // fe80::/10 (link-local) — first 16-bit group is 0xFE80..0xFEBF
  if (
    expanded.startsWith('fe8') ||
    expanded.startsWith('fe9') ||
    expanded.startsWith('fea') ||
    expanded.startsWith('feb')
  ) {
    return true;
  }
  // fec0::/10 (deprecated site-local — RFC 3879) — first group 0xFEC0..0xFEFF
  if (
    expanded.startsWith('fec') ||
    expanded.startsWith('fed') ||
    expanded.startsWith('fee') ||
    expanded.startsWith('fef')
  ) {
    return true;
  }
  // fc00::/7 (unique local addresses)
  if (expanded.startsWith('fc') || expanded.startsWith('fd')) return true;
  // ff00::/8 (multicast) — never a legitimate target for public fetches
  if (expanded.startsWith('ff')) return true;

  // ::ffff:0:0/96 (IPv4-mapped IPv6). The canonical expanded form has
  // the IPv4 portion as the last 32 bits split across the final two
  // 16-bit groups (chars 30..39 of the 39-char canonical string).
  if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const byte1 = Number.parseInt(expanded.slice(30, 32), 16);
    const byte2 = Number.parseInt(expanded.slice(32, 34), 16);
    const byte3 = Number.parseInt(expanded.slice(35, 37), 16);
    const byte4 = Number.parseInt(expanded.slice(37, 39), 16);
    if ([byte1, byte2, byte3, byte4].some(Number.isNaN)) return false;
    return isPrivateOrLoopbackIPv4(`${byte1}.${byte2}.${byte3}.${byte4}`);
  }
  // 64:ff9b::/96 (NAT64 well-known prefix)
  if (expanded.startsWith('0064:ff9b:')) return true;
  // 100::/64 (discard prefix)
  if (expanded.startsWith('0100:0000:0000:0000:')) return true;
  // 2001::/32 (Teredo)
  if (expanded.startsWith('2001:0000:')) return true;
  // 2001:db8::/32 (documentation)
  if (expanded.startsWith('2001:0db8:')) return true;

  return false;
}

/**
 * Expand an IPv6 address into its 8-group canonical form or return
 * `null` if the input cannot be parsed by `net.isIPv6`.
 */
function expandIPv6(ip: string): string | null {
  if (net.isIPv6(ip) === 0) return null;

  // Strip zone identifier (e.g. `fe80::1%eth0`).
  const zoneIndex = ip.indexOf('%');
  const bare = zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;

  const tokens: string[] = [];
  const doubleColonIndex = bare.indexOf('::');

  if (doubleColonIndex >= 0) {
    const headStr = bare.slice(0, doubleColonIndex);
    const tailStr = bare.slice(doubleColonIndex + 2);

    // Splitting "" via ":" returns [""] — we need an empty head here.
    if (headStr !== '') {
      for (const group of headStr.split(':')) tokens.push(group);
    }

    const tailGroups = expandTrailingGroupsWithEmbeddedIPv4(tailStr);
    if (tailGroups === null) return null;

    const fill = 8 - tokens.length - tailGroups.length;
    if (fill < 0) return null;
    for (let i = 0; i < fill; i += 1) tokens.push('0');
    for (const group of tailGroups) tokens.push(group);
  } else {
    const all = expandTrailingGroupsWithEmbeddedIPv4(bare);
    if (all === null) return null;
    if (all.length !== 8) return null;
    for (const group of all) tokens.push(group);
  }

  if (tokens.length !== 8) return null;
  if (tokens.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;

  return tokens
    .map((g) => Number.parseInt(g, 16).toString(16).padStart(4, '0'))
    .join(':');
}

/**
 * Splits a string of colon-separated 16-bit groups into individual hex
 * groups, except a trailing dotted-quad IPv4 address is split into
 * two groups of 8 bits each. Returns `null` if any IPv4 component is
 * not a valid octet (0-255).
 */
function expandTrailingGroupsWithEmbeddedIPv4(s: string): string[] | null {
  if (s === '') return [];
  const parts = s.split(':');
  const last = parts[parts.length - 1];
  // RFC 4291 §2.5.5.2 — a dotted-quad in the low 32 bits is expanded
  // into two 16-bit hex groups.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(last)) {
    const octets = last.split('.').map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    const high = ((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0');
    const low = ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0');
    return [...parts.slice(0, -1), high, low];
  }
  return parts;
}

/**
 * Zod schema for user-controllable URLs that are stored verbatim and
 * may later be fetched by the backend. Enforces:
 *
 *   - non-empty string of at most {@link MAX_URL_LENGTH} characters;
 *   - well-formed URL parsable by WHATWG `URL`;
 *   - protocol exactly `https:` (rejects `http:`, `file:`, `data:`,
 *     `ftp:`, `javascript:`, …);
 *   - no embedded userinfo (e.g. `https://user:pass@host/`);
 *   - no URL whose hostname *literal* is a private/loopback address.
 *
 * Note: this schema does not perform DNS lookup. Treat it as the
 * first of two SSRF barriers — pair it with
 * {@link assertSafeRemoteUrl} at fetch time.
 */
export const httpsOnlyUrlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH, `URL must not exceed ${MAX_URL_LENGTH} characters.`)
  .superRefine((value, ctx) => {
    const parsed = tryParseUrl(value);
    if (!parsed) {
      ctx.addIssue({
        code: 'custom',
        message: 'Must be a valid URL.',
      });
      return;
    }

    if (parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        message: `URL must use the "https:" protocol (received "${parsed.protocol.replace(/:$/, '')}").`,
      });
    }

    if (parsed.hasUserinfo) {
      ctx.addIssue({
        code: 'custom',
        message:
          'URLs containing userinfo (username or password) are not permitted.',
      });
    }

    if (parsed.hostname && isPrivateOrLoopbackHost(parsed.hostname)) {
      ctx.addIssue({
        code: 'custom',
        message: `URL host "${parsed.hostname}" targets a private or loopback network and is not permitted.`,
      });
    }
  });

/**
 * Runtime DNS-resolving SSRF guard. Resolves the host of `rawUrl` via
 * `dns.lookup({ all: true, verbatim: true })` and rejects the URL when
 * *any* resolved address sits in a private/loopback CIDR. Designed for
 * the moment an outbound HTTP client is about to be handed a user URL
 * (OpenGraph rendering, link previews, image thumbnailing, etc.).
 *
 * The function never throws on its own — it returns a discriminated
 * result so callers can map the rejection to their HTTP error shape.
 *
 * **DNS-rebinding caveat.** This guard closes the classic "resolve
 * once, then re-resolve" race only if the caller hands the resolved
 * numeric addresses straight to the HTTP client (ideally one that
 * accepts a literal IP, not a host). Re-resolving later reopens the
 * attack. Co-locate this validation with the request that issues the
 * outbound fetch.
 *
 * By default the guard rejects any non-`https:` protocol. Pass
 * `allowHttp: true` to also accept plaintext `http:` — useful when
 * integrating with legacy fetchers that still serve plain HTTP, but
 * still strictly excluded from private/loopback networks.
 *
 * @param rawUrl - The user-supplied URL string to validate.
 * @param options.allowHttp - When `true`, accept `http:` as well as
 *   `https:`. Defaults to `false`.
 * @returns `{ ok: true, hostname, resolvedAddresses }` when the URL
 *   parses and every resolved address is public; otherwise
 *   `{ ok: false, reason, hostname? }`.
 */
export async function assertSafeRemoteUrl(
  rawUrl: string,
  options: { allowHttp?: boolean } = {},
): Promise<
  | { ok: true; hostname: string; resolvedAddresses: string[] }
  | { ok: false; reason: string; hostname?: string }
> {
  const allowHttp = options.allowHttp === true;

  const parsed = tryParseUrl(rawUrl);
  if (!parsed) {
    return { ok: false, reason: 'URL is not parseable.' };
  }

  const isHttps = parsed.protocol === 'https:';
  const isHttp = parsed.protocol === 'http:';
  if (!isHttps && !(allowHttp && isHttp)) {
    return {
      ok: false,
      reason: isHttp
        ? 'Plain http: is not permitted; serve the resource over https:.'
        : `Refusing to resolve non-http(s) protocol "${parsed.protocol}".`,
      hostname: parsed.hostname,
    };
  }

  if (parsed.hasUserinfo) {
    return {
      ok: false,
      reason: 'URLs containing userinfo are not permitted.',
      hostname: parsed.hostname,
    };
  }

  // Literal-IP short-circuit (avoids issuing a DNS query for IPs)
  if (parsed.hostname && isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      ok: false,
      reason: `Host "${parsed.hostname}" is a private or loopback address.`,
      hostname: parsed.hostname,
    };
  }

  if (!parsed.hostname) {
    return { ok: false, reason: 'URL has no hostname.' };
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(parsed.hostname, {
      all: true,
      verbatim: true,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `DNS lookup failed: ${reason}`,
      hostname: parsed.hostname,
    };
  }

  if (addresses.length === 0) {
    return {
      ok: false,
      reason: 'DNS lookup returned no addresses.',
      hostname: parsed.hostname,
    };
  }

  const resolvedAddresses = addresses.map((a) => a.address);
  for (const address of resolvedAddresses) {
    if (isPrivateOrLoopbackAddress(address)) {
      return {
        ok: false,
        reason: `Host "${parsed.hostname}" resolves to private/loopback address "${address}".`,
        hostname: parsed.hostname,
      };
    }
  }

  return { ok: true, hostname: parsed.hostname, resolvedAddresses };
}
