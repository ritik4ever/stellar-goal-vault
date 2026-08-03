# Security Review Checklist

This checklist maps OWASP Top-10 (2021) categories to specific code areas in the Stellar Goal Vault codebase. Reviewers should walk through each applicable item before merging PRs that touch API, contract, or authentication code.

---

## How to use

1. Open the PR and identify which areas are affected (API, contract, auth, etc.).
2. Go through the relevant sections below.
3. Check off items that apply. Document any findings in the PR comments.
4. Mark the "Security review" item in the PR template as complete.

---

## A01:2021 – Broken Access Control

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 1 | Public endpoints are correctly excluded from auth | [`apiKeyAuth.ts`](backend/src/middleware/apiKeyAuth.ts#L23-L30) `publicPaths` array | Confirm new GET endpoints added to `publicPaths` if they should be unauthenticated |
| 2 | CORS is scoped to known origins in production | [`index.ts`](backend/src/index.ts#L77-L93) `cors()` middleware | Verify `ALLOWED_ORIGINS` env var is set, not the wildcard fallback |
| 3 | Admin-only operations require authenticated API key | [`apiKeyAuth.ts`](backend/src/middleware/apiKeyAuth.ts#L50-L63) | Ensure any new write endpoint is not added to `publicPaths` |
| 4 | Rate limits protect write endpoints from abuse | [`index.ts`](backend/src/index.ts#L108-L141) `WRITE_RATE_LIMIT_MAX_REQUESTS` | Confirm new `POST/PUT/DELETE` routes use `applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS)` |

## A02:2021 – Cryptographic Failures

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 5 | API keys are not logged or exposed in error responses | [`logger.ts`](backend/src/logger.ts), [`errors.ts`](backend/src/types/errors.ts) | Search for `req.headers.authorization` or `apiKey` in log statements; ensure redacted |
| 6 | Contract uses `overflow-checks = true` | [`Cargo.toml`](contracts/Cargo.toml#L18) | Confirm `overflow-checks = true` remains in `[profile.release]` |
| 7 | No hardcoded secrets in source code | All files | `grep -r "SECRET_KEY\|secret\|password\|private_key" --include="*.ts" --include="*.rs" --include="*.js"` should show only env reads, not literals |
| 8 | Network passphrase is configurable (not hardcoded testnet) | [`config.ts`](backend/src/config.ts#L32-L33) `sorobanNetworkPassphrase` | Verify env var drives the value, not a constant |

## A03:2021 – Injection

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 9 | All SQL queries use parameterised statements | [`db.ts`](backend/src/services/db.ts), [`campaignStore.ts`](backend/src/services/campaignStore.ts) | Confirm no string concatenation in `.prepare()` calls; all use `?` or `@param` placeholders |
| 10 | User input is validated with Zod schemas before database writes | [`schemas.ts`](backend/src/validation/schemas.ts) | Every new endpoint body must have a corresponding schema and be validated with `safeParse()` |
| 11 | Asset codes are constrained to allowed list | [`schemas.ts`](backend/src/validation/schemas.ts#L27-L29) `config.allowedAssets` | Any new token/asset input must be validated against `allowedAssets` |
| 12 | Stellar account IDs pass regex validation | [`schemas.ts`](backend/src/validation/schemas.ts#L14-L19) `STELLAR_ACCOUNT_REGEX` | Confirm `G` prefix + 55-char base32 pattern enforced |
| 13 | JSON body size is limited | [`index.ts`](backend/src/index.ts#L95-L96) `bodySizeLimit = "16kb"` | Confirm `express.json({ limit: ... })` is set and not removed |
| 14 | Contract validates input lengths and ranges | [`lib.rs`](contracts/src/lib.rs) | Verify Soroban contract checks contribution amounts, deadlines, and addresses before mutating state |

## A04:2021 – Insecure Design

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 15 | Rate limiting applies to write-heavy endpoints | [`index.ts`](backend/src/index.ts#L424-L427) `applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS)` | Confirm all pledge, claim, refund routes wrapped |
| 16 | Database migration logic handles idempotent upgrades | [`db.ts`](backend/src/services/db.ts#L73-L174) `migrate()` | New columns added with `IF NOT EXISTS` guards; use `try/catch` for ALTER TABLE |
| 17 | New environment variables have sensible defaults | [`config.ts`](backend/src/config.ts), [`validateEnv.ts`](backend/src/validateEnv.ts) | Ensure `validateEnv()` allows optional vars and `config.ts` provides fallbacks |

## A05:2021 – Security Misconfiguration

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 18 | CORS is disabled/restricted in production | [`index.ts`](backend/src/index.ts#L77-L93) | Confirm `isDev` check and `corsAllowedOrigins.length === 0` only bypasses in dev |
| 19 | Production authentication is enforced | [`index.ts`](backend/src/index.ts#L99-L101) `NODE_ENV === "production"` | Confirm `apiKeyAuthMiddleware` is only mounted when `NODE_ENV=production` |
| 20 | No debug endpoints exposed in production | [`index.ts`](backend/src/index.ts) | Confirm no `/debug/`, `/admin/`, `/dev/` routes exist; health endpoint returns minimal info |
| 21 | Environment validation blocks startup on missing required vars | [`validateEnv.ts`](backend/src/validateEnv.ts) | Run backend with missing `CONTRACT_ID` — should exit with clear error |
| 22 | HTTP response headers do not leak stack traces | [`index.ts`](backend/src/index.ts#L626-L686) error handler | Confirm `err.message` in production does not contain stack — `AppError` messages are user-facing |
| 23 | CORS error responses do not reveal internal configuration | [`index.ts`](backend/src/index.ts#L639-L644) | Confirm CORS errors return generic `"CORS policy violation"`, not the origin |
| 24 | Docker containers use restart limits and health checks | [`docker-compose.yml`](docker-compose.yml) | Verify `restart: unless-stopped` and `healthcheck` block exist for both services |

## A06:2021 – Vulnerable and Outdated Components

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 25 | Dependabot is configured for all package ecosystems | [`.github/dependabot.yml`](.github/dependabot.yml) | Confirm npm (backend, frontend) and cargo (contracts) are covered |
| 26 | No `npm audit` warnings ignored without reason | `package.json` files | Run `npm audit` in backend/ and frontend/; any ignored advisories must be documented |
| 27 | Contract dependencies use a specific, pinned Soroban SDK version | [`Cargo.toml`](contracts/Cargo.toml#L10) | Confirm no `"*"` or `"latest"` version specifiers |

## A07:2021 – Identification and Authentication Failures

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 28 | API key comparison is constant-time (no timing oracle) | [`apiKeyAuth.ts`](backend/src/middleware/apiKeyAuth.ts#L59) `validApiKeys.includes(apiKey)` | `Array.includes` uses `===` which is safe; no deliberate constant-time bypass needed |
| 29 | Missing or invalid auth headers return 401, not 500 | [`apiKeyAuth.ts`](backend/src/middleware/apiKeyAuth.ts#L42-L46) | Confirm `401 UNAUTHORIZED` thrown without stack trace details |
| 30 | Empty API_KEYS env behaves safely (dev mode only) | [`apiKeyAuth.ts`](backend/src/middleware/apiKeyAuth.ts#L52-L57) | Confirm empty env allows all requests only in dev, and production always requires keys |

## A08:2021 – Software and Data Integrity Failures

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 31 | npm dependencies are verified via package-lock.json | `package-lock.json` files | Confirm lock files are committed (not in `.gitignore`) |
| 32 | SRI integrity check script exists for CDN resources | [`scripts/check-sri.sh`](scripts/check-sri.sh) | Ensure script is run during CI/CD pipeline |
| 33 | deploy.sh validates the contract ID format (56 chars) | [`scripts/deploy.sh`](scripts/deploy.sh#L92-L97) | Confirm regex or length check before writing contract ID |

## A09:2021 – Security Logging and Monitoring Failures

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 34 | All API requests are logged with request ID | [`index.ts`](backend/src/index.ts#L145-L165) `logRequest()` | Confirm every route produces a log entry with `requestId`, method, path, status, `durationMs` |
| 35 | Write operations are auditable via event history | [`eventHistory.ts`](backend/src/services/eventHistory.ts) `recordEvent()` | Verify pledge, claim, refund events include `actor`, `amount`, `timestamp` |
| 36 | On-chain events are indexed and track tx hashes | [`eventIndexer.ts`](backend/src/services/eventIndexer.ts) | Confirm `blockchainMetadata.txHash` is stored for Soroban events |
| 37 | Error logs include request context (method, path, requestId) | [`index.ts`](backend/src/index.ts#L671-L683) `logError()` | Ensure all caught errors log the originating request details |

## A10:2021 – Server-Side Request Forgery (SSRF)

| # | Check | Relevant Code | How to Verify |
|---|-------|--------------|---------------|
| 38 | Soroban RPC URL is validated as a URL, not user-controlled input | [`validateEnv.ts`](backend/src/validateEnv.ts#L18-L19) `z.string().url()` | Confirm RPC URL is read from env var only, not from request query/body |
| 39 | Open issues fetch uses a hardcoded URL (no user input in URL) | [`openIssues.ts`](backend/src/services/openIssues.ts) | Verify the URL is a constant, not constructed from user-provided data |
| 40 | No URL/redirect parameters accepted from user input | All endpoints | Confirm no route accepts a URL parameter for server-side fetch or redirect |

---

## How this maps to the PR template

When reviewing a PR, paste the applicable items from this checklist into the PR's "Security review" section. For example:

```markdown
## Security review

- [x] A03-1: SQL uses parameterised statements — verified `db.prepare()` uses `?` placeholders for new query
- [x] A03-2: New endpoint `/api/new-thing` has Zod schema validation — created `newThingSchema`
- [x] A05-3: No debug endpoints introduced — only the intended route was added
- [ ] A07-1: API key check — n/a, endpoint is public
```

---

*Last updated: 2026-06-01*