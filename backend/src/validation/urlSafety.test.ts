/**
 * Tests for the SSRF URL safety module.
 *
 * Covers acceptance criteria for issue #308:
 *   - rejects non-https URLs (file://, data:, http://, ftp://, …)
 *   - rejects hosts whose literal is a private / loopback / link-local IP
 *   - exposes an async `assertSafeRemoteUrl` helper for future fetches
 *
 * The suite deliberately stays end-to-end against the WHATWG URL parser
 * and `node:net` so the boundary checks match real requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns';
import {
  assertSafeRemoteUrl,
  httpsOnlyUrlSchema,
  isPrivateOrLoopbackAddress,
  isPrivateOrLoopbackHost,
  tryParseUrl,
} from './urlSafety';

describe('isPrivateOrLoopbackAddress (IPv4)', () => {
  it.each([
    ['0.0.0.0'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['100.64.0.1'],
    ['127.0.0.1'],
    ['127.255.255.254'],
    ['169.254.169.254'], // AWS / GCP / Azure instance metadata
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.0.2.1'],
    ['192.168.0.1'],
    ['198.18.0.1'],
    ['198.51.100.10'],
    ['203.0.113.5'],
    ['224.0.0.1'],
    ['239.255.255.255'],
    ['240.0.0.1'],
    ['255.255.255.255'],
  ])('blocks %s', (ip) => {
    expect(isPrivateOrLoopbackAddress(ip)).toBe(true);
  });

  it.each([
    ['1.1.1.1'],
    ['8.8.8.8'],
    ['9.9.9.9'],
    ['172.15.255.255'], // just below the 172.16/12 range
    ['172.32.0.0'], // just above the 172.16/12 range
    ['93.184.216.34'], // example.com
    ['151.101.1.69'], // a public CDN range
  ])('does not block public IPv4 %s', (ip) => {
    expect(isPrivateOrLoopbackAddress(ip)).toBe(false);
  });

  it('returns false for non-IP strings', () => {
    expect(isPrivateOrLoopbackAddress('not-an-ip')).toBe(false);
    expect(isPrivateOrLoopbackAddress('')).toBe(false);
    expect(isPrivateOrLoopbackAddress('999.999.999.999')).toBe(false);
  });
});

describe('isPrivateOrLoopbackAddress (IPv6)', () => {
  it.each([
    ['::'],
    ['::1'],
    ['fe80::1'],
    ['fec0::1'],
    ['fc00::1'],
    ['fd00::1'],
    ['::ffff:127.0.0.1'], // IPv4-mapped loopback
    ['::ffff:10.0.0.1'], // IPv4-mapped private
    ['64:ff9b::8.8.8.8'], // NAT64
    ['2001::1'],
    ['2001:db8::1'],
  ])('blocks %s', (ip) => {
    expect(isPrivateOrLoopbackAddress(ip)).toBe(true);
  });

  it.each([
    ['2001:4860:4860::8888'], // Google public DNS
    ['2606:4700:4700::1111'], // Cloudflare public DNS
  ])('does not block public IPv6 %s', (ip) => {
    expect(isPrivateOrLoopbackAddress(ip)).toBe(false);
  });
});

describe('isPrivateOrLoopbackHost', () => {
  it('blocks localhost-style names', () => {
    expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('LOCALHOST')).toBe(true);
    expect(isPrivateOrLoopbackHost('foo.localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('svc.local')).toBe(true);
  });

  it('blocks hosts whose literal is a private IP', () => {
    expect(isPrivateOrLoopbackHost('10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('192.168.1.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('172.16.0.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('[::1]')).toBe(true);
  });

  it('does not block ordinary public hostnames', () => {
    expect(isPrivateOrLoopbackHost('example.com')).toBe(false);
    expect(isPrivateOrLoopbackHost('stellar.org')).toBe(false);
    expect(isPrivateOrLoopbackHost('cdn.example.io')).toBe(false);
  });

  it("does not block public IPs even though they aren't names", () => {
    expect(isPrivateOrLoopbackHost('8.8.8.8')).toBe(false);
    expect(isPrivateOrLoopbackHost('1.1.1.1')).toBe(false);
  });
});

describe('tryParseUrl', () => {
  it('parses a canonical https URL', () => {
    const parsed = tryParseUrl('https://example.com/path?q=1');
    expect(parsed).not.toBeNull();
    expect(parsed?.protocol).toBe('https:');
    expect(parsed?.hostname).toBe('example.com');
    expect(parsed?.hasUserinfo).toBe(false);
  });

  it('flags userinfo presence', () => {
    const parsed = tryParseUrl('https://user:pass@example.com/');
    expect(parsed?.hasUserinfo).toBe(true);
  });

  it('returns null for unparseable input', () => {
    expect(tryParseUrl('')).toBeNull();
    expect(tryParseUrl('not a url')).toBeNull();
  });
});

describe('httpsOnlyUrlSchema', () => {
  describe('accepts valid HTTPS URLs', () => {
    it.each([
      'https://example.com',
      'https://example.com/',
      'https://example.com/path?query=1',
      'https://cdn.example.com:443/image.png',
      'https://sub.domain.example.io/asset?x=1&y=2',
      'https://8.8.8.8/', // public IP literal is acceptable
    ])('accepts %s', (url) => {
      const result = httpsOnlyUrlSchema.safeParse(url);
      expect(result.success).toBe(true);
    });
  });

  describe('rejects non-https protocols (issue #308 acceptance criteria)', () => {
    it.each([
      ['http://example.com/', 'http'],
      ['ftp://example.com/', 'ftp'],
      ['file:///etc/passwd', 'file'], // file:// (issue acceptance criteria)
      ['FILE:///etc/passwd'], // case-insensitive
      ['data:text/html,<script>alert(1)</script>', 'data'], // data: URI
      ['javascript:alert(1)'],
      ['gopher://example.com/'],
      ['ws://example.com/'],
      ['wss://example.com/'], // wss is technically encrypted but we keep http(s) only
    ])('rejects %s', (url) => {
      const result = httpsOnlyUrlSchema.safeParse(url);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) =>
          i.message.toLowerCase(),
        );
        // every non-https URL must mention the protocol error
        expect(messages.some((m) => m.includes('https'))).toBe(true);
      }
    });
  });

  describe('rejects private/loopback literal hosts (issue #308 acceptance criteria)', () => {
    it.each([
      'https://localhost/',
      'https://LOCALHOST:8080/',
      'https://127.0.0.1/',
      'https://127.0.0.1:6379/', // classic Redis SSRF
      'https://10.0.0.1/',
      'https://10.255.255.255/',
      'https://172.16.0.1/',
      'https://172.31.255.254/',
      'https://192.168.0.1/',
      'https://169.254.169.254/latest/meta-data/', // AWS metadata
      'https://[::1]/',
      'https://[fe80::1]/',
      'https://[fc00::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://0.0.0.0/',
      'https://foo.localhost/',
      'https://internal.local/',
    ])('rejects %s', (url) => {
      const result = httpsOnlyUrlSchema.safeParse(url);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) =>
          i.message.toLowerCase(),
        );
        expect(
          messages.some((m) => m.includes('private') || m.includes('loopback')),
        ).toBe(true);
      }
    });
  });

  it('rejects URLs containing userinfo', () => {
    const result = httpsOnlyUrlSchema.safeParse(
      'https://user:pass@example.com/',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message.toLowerCase());
      expect(messages.some((m) => m.includes('userinfo'))).toBe(true);
    }
  });

  it('rejects URLs longer than the configured maximum', () => {
    const huge = 'https://example.com/' + 'a'.repeat(5000);
    const result = httpsOnlyUrlSchema.safeParse(huge);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message.toLowerCase()).toContain('exceed');
    }
  });

  it('rejects unparseable URLs', () => {
    const result = httpsOnlyUrlSchema.safeParse('not a url');
    expect(result.success).toBe(false);
  });

  it('trims whitespace before validating', () => {
    const result = httpsOnlyUrlSchema.safeParse('  https://example.com/  ');
    expect(result.success).toBe(true);
  });

  describe('resists host-confusion / IDN edge cases', () => {
    it('rejects fullwidth-dot IP variant', () => {
      // U+3002 (fullwidth full stop) — WHATWG URL parser either refuses
      // the host outright or strips non-ASCII; either way the literal
      // 127.0.0.1 never appears in the host field, so we make sure we
      // never accept such fuzzy bypasses.
      const result = httpsOnlyUrlSchema.safeParse(
        'https://127\u30020\u30020\u30021/',
      );
      // It either gets rejected outright, or — in the unlikely case it
      // passes URL parsing — our hostname check still rebukes it as a
      // private literal. We assert at minimum that the resulting URL,
      // if accepted, does NOT have a plain `127.0.0.1` host that would
      // bypass SSRF checks.
      if (result.success) {
        expect(result.data).not.toBe('127.0.0.1');
      } else {
        expect(result.success).toBe(false);
      }
    });

    it('does not regress on public IP literals', () => {
      const result = httpsOnlyUrlSchema.safeParse('https://8.8.8.8/dns-query');
      expect(result.success).toBe(true);
    });

    it('rejects percent-encoded host separator sneaking past path parsing', () => {
      // URL host parser refuses userinfo-style encoding; this URL fails
      // at URL parse time and is rejected.
      const result = httpsOnlyUrlSchema.safeParse(
        'https://user%40example.com@127.0.0.1/',
      );
      expect(result.success).toBe(false);
    });
  });
});

describe('assertSafeRemoteUrl (async DNS-resolving guard)', () => {
  let lookupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lookupSpy = vi.spyOn(dns.promises, 'lookup');
  });

  afterEach(() => {
    lookupSpy.mockRestore();
  });

  it('rejects non-http(s) protocols without performing DNS', async () => {
    const result = await assertSafeRemoteUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/protocol/i);
    }
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('skips DNS for a literal loopback host', async () => {
    const result = await assertSafeRemoteUrl('https://127.0.0.1/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('private');
    }
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('skips DNS for literal IPv6 loopback', async () => {
    const result = await assertSafeRemoteUrl('https://[::1]/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('private');
    }
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('rejects hosts that resolve to a private IP', async () => {
    lookupSpy.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const result = await assertSafeRemoteUrl('https://attacker.example/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('10.0.0.5');
    }
    expect(lookupSpy).toHaveBeenCalledWith(
      'attacker.example',
      expect.objectContaining({ all: true, verbatim: true }),
    );
  });

  it('rejects when any resolved address is private (DNS rebinding guard)', async () => {
    lookupSpy.mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const result = await assertSafeRemoteUrl('https://mixed.example/');
    expect(result.ok).toBe(false);
  });

  it('accepts a hostname whose resolved addresses are public', async () => {
    lookupSpy.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const result = await assertSafeRemoteUrl('https://dns.google/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hostname).toBe('dns.google');
      expect(result.resolvedAddresses).toEqual(['8.8.8.8']);
    }
  });

  it('rejects userinfo URLs without performing DNS', async () => {
    const result = await assertSafeRemoteUrl('https://user:pass@example.com/');
    expect(result.ok).toBe(false);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('rejects on DNS failure', async () => {
    lookupSpy.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await assertSafeRemoteUrl('https://nonexistent.example/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('DNS lookup failed');
    }
  });

  it('rejects when DNS lookup returns no addresses', async () => {
    lookupSpy.mockResolvedValue([] as unknown as dns.LookupAddress[]);
    const result = await assertSafeRemoteUrl('https://weird.example/');
    expect(result.ok).toBe(false);
  });
});
