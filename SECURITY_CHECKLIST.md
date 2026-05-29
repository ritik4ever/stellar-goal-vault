# Security Review Checklist (OWASP Top 10)

This checklist maps OWASP Top 10 (2021) vulnerability categories to relevant
code areas in the Stellar Goal Vault project. Use this during PR reviews to
ensure security is considered before merging.

---

## A01: Broken Access Control

- [ ] API endpoints verify the authenticated user owns the resource
- [ ] Campaign creators can only modify their own campaigns
- [ ] Pledge amounts cannot be manipulated by non-owners
- [ ] Contract functions check `require_auth()` for sensitive operations
- [ ] Rate limiting is applied to critical endpoints

**Relevant files:** `backend/src/routes/`, `contracts/src/`

---

## A02: Cryptographic Failures

- [ ] Private keys never appear in logs, error messages, or client code
- [ ] Stellar addresses are validated with `StrKey.isValidEd25519PublicKey()`
- [ ] HTTPS is enforced in production
- [ ] Contract ID is stored server-side, not exposed to unauthorized users
- [ ] Freighter signing always uses the current network (testnet/mainnet)

**Relevant files:** `backend/src/validation/`, `frontend/src/hooks/useFreighter.ts`

---

## A03: Injection

- [ ] All user inputs are validated with Zod schemas before processing
- [ ] SQL queries use parameterized statements (no string concatenation)
- [ ] Campaign titles and descriptions are sanitized against XSS
- [ ] Soroban RPC calls validate address formats before submission
- [ ] Campaign image URLs restrict protocol to `https://` only

**Relevant files:** `backend/src/validation/`, `backend/src/models/`

---

## A04: Insecure Design

- [ ] Rate limiting is configured for create/pledge endpoints
- [ ] Campaign deadlines are enforced server-side, not just client-side
- [ ] Request body size is limited to prevent payload flooding
- [ ] WebSocket connections are authenticated
- [ ] Audit logging is enabled for all state-changing operations

**Relevant files:** `backend/src/routes/`, `backend/src/middleware/`

---

## A05: Security Misconfiguration

- [ ] CORS is configured with a specific origin allowlist (not `*`)
- [ ] Error responses do not leak stack traces or internal paths
- [ ] Default passwords or API keys are not used in production
- [ ] Docker containers run as non-root user
- [ ] `Content-Security-Policy` header is set on the frontend

**Relevant files:** `backend/src/app.ts`, `docker-compose.yml`

---

## A06: Vulnerable and Outdated Components

- [ ] `npm audit --audit-level=high` passes for backend and frontend
- [ ] `cargo audit` passes for contracts
- [ ] Dependabot is configured for weekly dependency updates
- [ ] Major version upgrades are reviewed before merging
- [ ] Lock files (`package-lock.json`, `Cargo.lock`) are up to date

**Relevant files:** `.github/dependabot.yml`, `.github/workflows/`

---

## A07: Identification and Authentication Failures

- [ ] Campaign creator identity is verified via Freighter public key
- [ ] The same Stellar address cannot create duplicate campaigns
- [ ] WebSocket connections validate the sender's public key
- [ ] Session tokens (if used) have appropriate expiry

**Relevant files:** `frontend/src/hooks/useFreighter.ts`, `backend/src/middleware/auth.ts`

---

## A08: Software and Data Integrity Failures

- [ ] CI/CD pipeline is the only way to deploy to production
- [ ] Dependencies are installed from npm registry (lockfile verified)
- [ ] GitHub Actions workflows are pinned to specific action versions
- [ ] Release tags are signed or verified

**Relevant files:** `.github/workflows/`

---

## A09: Security Logging and Monitoring Failures

- [ ] All API errors are logged with request context
- [ ] Failed authentication attempts are logged
- [ ] Pledge and refund operations are logged with actor address
- [ ] Contract invocation errors are captured and logged
- [ ] Log rotation is configured to prevent disk exhaustion

**Relevant files:** `backend/src/middleware/logging.ts`

---

## A10: Server-Side Request Forgery (SSRF)

- [ ] Any user-supplied URLs (imageUrl, externalLink) are validated
- [ ] Only `https://` protocol is allowed for external URLs
- [ ] If the backend fetches external URLs, private IP ranges are blocked
- [ ] DNS rebinding protection is considered for URL validation

**Relevant files:** `backend/src/validation/schemas.ts`

---

## How to Use This Checklist

1. When opening a PR, check off all items relevant to your changes
2. Reviewers should verify the checklist is complete before approving
3. Add new items as new vulnerability patterns are discovered
4. This checklist should be reviewed quarterly against current OWASP guidance

---

## References

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [Stellar Security Best Practices](https://developers.stellar.org/docs/security)
- [GitHub Security Best Practices](https://docs.github.com/en/code-security)
