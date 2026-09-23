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

## Details

### `ALLOWED_ORIGINS` (CORS)

- **Safe production default:** an explicit allow-list, e.g.
  `ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com`.
- **Local development:** leave it empty or set `ALLOWED_ORIGINS=*`. In
  `development`, an empty value allows all origins so Vite on a random port
  still works.
- **Risk of weakening:** a wildcard (`*`) or empty value in production lets any
  website make browser-originated requests to the API; combined with
  ambient/at-rest auth this enables cross-site abuse.
- **Compatibility:** `CORS_ALLOWED_ORIGINS` is accepted as a backwards-compatible
  alias, but new deployments should use `ALLOWED_ORIGINS`.

### `API_KEYS`

- **Safe production default:** a strong random key per client, rotated
  periodically, e.g. `API_KEYS=<random-1>,<random-2>`.
- **Local development:** leave unset. When `API_KEYS` is empty the API key
  middleware allows requests so local tools work without credentials.
- **Risk of weakening:** the middleware is only mounted when
  `NODE_ENV=production`; if `API_KEYS` is empty there, **write endpoints are
  unauthenticated**. Always set `API_KEYS` in production.
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

## Rotation

When rotating any secret, update the value in the platform secret manager,
redeploy, then revoke the previous value. Rotate immediately if a secret is ever
committed or shared in plaintext.

## See also

- [SECURITY.md](../SECURITY.md) — responsible disclosure policy.
- [DEPLOYMENT.md](../DEPLOYMENT.md) — deployment steps and environment setup.
- [backend/.env.example](../backend/.env.example) — annotated variable list.
