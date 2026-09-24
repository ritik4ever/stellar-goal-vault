# Secure configuration and secret defaults

This document is the single reference for the security-relevant configuration of
Stellar Goal Vault: **the safe production default, the local-development
override, and the risk of weakening each setting.** A deployer should be able to
configure a production environment from this page without reading the
implementation.

The committed `.env.example` files contain **placeholders only**. Never commit a
real `.env`, API key, private key, or database URL. Secret scanning
(`.gitleaks.toml`) runs in CI to catch accidental commits.

## Quick reference

| Setting | Safe production default | Local-development override | Risk if weakened |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | `development` | In `development`, API-key auth and other production hardening are skipped. |
| `CONTRACT_ID` | A real deployed contract ID | `mock-contract` or empty in tests | Wrong/empty ID breaks pledge signing or lets the app start unconfigured. |
| `SOROBAN_RPC_URL` | An HTTPS RPC endpoint you control/trust | testnet RPC | A malicious RPC can return false simulation/ledger data. |
| `SOROBAN_NETWORK_PASSPHRASE` | The passphrase matching the network | testnet passphrase | A mismatch signs transactions for the wrong network. |
| `ALLOWED_ORIGINS` | Explicit HTTPS origins, comma-separated | `*` (allow all) | `*` in production allows any site to call the API from a browser. |
| `API_KEYS` | A strong, random, comma-separated list | unset (auth disabled) | Unset in production disables write authentication entirely. |
| `WEBHOOK_SECRET` | A long random secret | unset | Unset means webhook signatures cannot be verified by the receiver. |
| `DB_PATH` | A path on persistent, access-controlled storage | `backend/data/campaigns.db` | World-readable/lost storage exposes or loses data. |
| `REDIS_URL` | Authenticated URL (`redis://:password@host`) | unset (in-memory cache) | An unauthenticated cache can be read/poisoned by other tenants. |
| `LOG_LEVEL` | `info` (never log secrets) | `debug` | Debug logs can leak request bodies/keys into logs. |
| `MAX_BODY_SIZE` | Valid size string (e.g. `16kb`, `1mb`) | `16kb` | Unvalidated or overly large payload limits enable body payload DoS attacks. |
| `RATE_LIMIT_WINDOW_MS` / limits | Positive numeric integers | `60000` / `120` | Disabling or misconfiguring rate limits exposes write endpoints to spam/bruteforce. |
| `SECRET_KEY` / `SERVER_PRIVATE_KEY` (contract deploy) | Long random value, injected at runtime | never set locally | A committed/weak key compromises contract control. |

## Startup validation (enforced automatically)

The table above is guidance; the rules below are **enforced by `validateEnv()`
at backend startup** — the server refuses to boot on a violating
configuration. Non-production (`development`/`test`) still permits every
local-development override.

| Setting | Rule | Applies in |
| --- | --- | --- |
| `NODE_ENV` | Accepted values are exactly `development`, `test`, `production`; anything else (e.g. `prod`) fails fast. Unset stays valid and resolves to `development`. | all environments |
| `ALLOWED_ORIGINS` | Must be a non-empty, non-wildcard explicit list. Each origin must be a valid URL with HTTPS protocol. Localhost, 127.0.0.1, and raw IP addresses are rejected. | production |
| `API_KEYS` | Must be non-empty. | production |
| `CONTRACT_ID` | Must be set. | production |
| `LOG_LEVEL` | `debug` is rejected. | production |
| `SOROBAN_RPC_URL` | Must be `https://`. | production |
| `WEBHOOK_SECRET` | Required when `WEBHOOK_URL` is set. | production |

## Abuse Controls

The backend implements several abuse control mechanisms to protect against malicious activity while allowing legitimate development workflows:

### API Key Authentication Abuse Controls

- **Failed attempt rate limiting:** 10 failed authentication attempts per minute per IP address. After exceeding this limit, further attempts return HTTP 429 with code `TOO_MANY_FAILED_ATTEMPTS`.
- **Per-API-key rate limiting:** 1000 requests per minute per API key. After exceeding this limit, requests return HTTP 429 with code `API_KEY_RATE_LIMITED`.
- **Development mode exemption:** All abuse controls are disabled in development and test modes to avoid blocking normal local development workflows.
- **Conditional activation:** Abuse controls only activate when API keys are actually configured in production. If no API keys are set, the system allows all requests (as in development mode).

### Rate Limiting

- **IP-based rate limiting:** General rate limiting applies to all requests (120 read requests per minute, 20 write requests per minute).
- **Separate limits:** Read and write operations have separate rate limits to allow high-volume read access while protecting write operations.
- **Headers:** Rate limit information is exposed in response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`).

### Monitoring

- **Statistics:** The `getAbuseControlStats()` function provides current cache sizes for monitoring abuse control activity.
- **Testing:** The `clearAbuseControlCaches()` function allows clearing abuse control caches for testing purposes.

## Details

### `ALLOWED_ORIGINS` (CORS)

- **Safe production default:** an explicit allow-list of HTTPS origins, e.g.
  `ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com`.
- **Local development:** leave it empty or set `ALLOWED_ORIGINS=*`. In
  `development`, an empty value allows all origins so Vite on a random port
  still works.
- **Risk of weakening:** a wildcard (`*`) or empty value in production lets any
  website make browser-originated requests to the API; combined with
  ambient/at-rest auth this enables cross-site abuse. HTTP origins, localhost,
  and raw IP addresses are also rejected in production.
- **Compatibility:** `CORS_ALLOWED_ORIGINS` is accepted as a backwards-compatible
  alias, but new deployments should use `ALLOWED_ORIGINS`.
- **Validation:** In production, each origin must be a valid URL with HTTPS
  protocol. Localhost, 127.0.0.1, and raw IP addresses are rejected to prevent
  misconfiguration and ensure proper security boundaries.

#### Production Configuration Examples

**Single frontend application:**
```bash
ALLOWED_ORIGINS=https://myapp.example.com
```

**Multiple frontend applications:**
```bash
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,https://www.example.com
```

**Frontend with multiple subdomains:**
```bash
ALLOWED_ORIGINS=https://*.example.com
```

**Platform deployment (e.g., Vercel, Netlify):**
```bash
ALLOWED_ORIGINS=https://stellar-goal-vault.vercel.app
```

#### Common Misconfigurations (Rejected in Production)

❌ **Wildcard** - Allows any website to make requests:
```bash
ALLOWED_ORIGINS=*
```

❌ **HTTP origins** - Unencrypted connections are rejected:
```bash
ALLOWED_ORIGINS=http://example.com
```

❌ **Localhost** - Development addresses are rejected:
```bash
ALLOWED_ORIGINS=https://localhost:3000
ALLOWED_ORIGINS=https://127.0.0.1:3000
```

❌ **IP addresses** - Raw IPs are rejected:
```bash
ALLOWED_ORIGINS=https://192.168.1.1
ALLOWED_ORIGINS=https://10.0.0.1
```

❌ **Missing protocol** - Invalid URL format:
```bash
ALLOWED_ORIGINS=example.com
```

#### Development Mode Behavior

In development (`NODE_ENV=development` or `NODE_ENV=test`), the following are allowed:
- Empty value: allows all origins
- Wildcard (`*`): allows all origins  
- HTTP origins: allowed for local development
- Localhost: allowed for local development
- Invalid formats: allowed for development flexibility

#### Startup Validation

The backend enforces these rules at startup in production:
- Non-empty, non-wildcard explicit list required
- Each origin must be a valid URL with HTTPS protocol
- Localhost, 127.0.0.1, and raw IP addresses are rejected
- Invalid URL formats are rejected

If validation fails, the server will not start with an actionable error message.

### `API_KEYS`

- **Safe production default:** a strong random key per client, rotated
  periodically, e.g. `API_KEYS=<random-1>,<random-2>`.
- **Local development:** leave unset. When `API_KEYS` is empty the API key
  middleware allows requests so local tools work without credentials.
- **Risk of weakening:** the middleware is only mounted when
  `NODE_ENV=production`; if `API_KEYS` is empty there, **write endpoints are
  unauthenticated**. Always set `API_KEYS` in production.
- **Abuse controls:** Failed authentication attempts are rate limited (10 failures per minute per IP) to prevent brute force attacks. Per-API-key usage is tracked (1000 requests per minute) to prevent individual key abuse.
- Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### `WEBHOOK_SECRET`

- **Safe production default:** a long random secret shared with the receiver;
  the backend signs payloads in the `X-GoalVault-Signature` header
  (HMAC-SHA256).
- **Local development:** unset; webhook dispatch is best-effort and skipped when
  no URL is configured.
- **Risk of weakening:** without a secret, receivers cannot distinguish genuine
  callbacks from forgeries.

### `SOROBAN_RPC_URL` and `SOROBAN_NETWORK_PASSPHRASE`

- **Safe production default:** an HTTPS RPC endpoint you trust and the passphrase
  for the intended network (mainnet or a chosen testnet).
- **Local development:** defaults to the Stellar testnet RPC and passphrase when
  both are unset and `NODE_ENV !== production`.
- **Risk of weakening:** pointing the app at an untrusted RPC can produce false
  transaction results; a passphrase that does not match the network signs for the
  wrong chain.

### `DB_PATH` and `REDIS_URL`

- **Safe production default:** `DB_PATH` on persistent, access-controlled storage;
  `REDIS_URL` with authentication.
- **Local development:** SQLite file under `backend/data/`, in-memory cache.
- **Risk of weakening:** a shared/unauth cache can be read or poisoned; a
  world-readable DB exposes campaign and pledge data.

### Secret material (`SECRET_KEY`, `SERVER_PRIVATE_KEY`)

- **Safe production default:** a long random value injected via the platform's
  secret manager (never in the image or repo).
- **Local development:** do not set; mocked flows do not need it.
- **Risk of weakening:** a leaked server secret key allows deploying/controlling
  contracts on your behalf.

## Logging and redaction

Secret configuration values (`API_KEYS`, `WEBHOOK_SECRET`, `SECRET_KEY`,
`SERVER_PRIVATE_KEY`, `REDIS_URL`, and similar) must never appear in application
logs — including failure paths and debug dumps.

The backend logger (`backend/src/logger.ts`) enforces this:

- `redactSensitive` / `redactSecretConfig` strip credentials, authorization
  headers, wallet secrets, and secret-configuration fields from structured log
  payloads.
- `summarizeSecretConfig` exposes only presence flags (e.g.
  `API_KEYS_configured: true`) for startup diagnostics — never the raw values.
- Pino `redact.paths` also censors common secret field names if they reach the
  transport layer.

When diagnosing configuration issues, log whether a secret is configured and
non-secret settings (port, `NODE_ENV`, `CONTRACT_ID`), not the secret material
itself.

## Rotation

When rotating any secret, update the value in the platform secret manager,
redeploy, then revoke the previous value. Rotate immediately if a secret is ever
committed or shared in plaintext.

## See also

- [SECURITY.md](../SECURITY.md) — responsible disclosure policy.
- [DEPLOYMENT.md](../DEPLOYMENT.md) — deployment steps and environment setup.
- [backend/.env.example](../backend/.env.example) — annotated variable list.
