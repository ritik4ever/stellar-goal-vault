# Security Policy

## Supported Versions

Only the latest revision on the `main` branch receives security fixes.
Older commits or forks are not supported.

| Version / Branch | Supported |
| ---------------- | --------- |
| `main` (latest)  | Yes       |
| Older commits    | No        |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability-reporting feature instead:

1. Navigate to the **Security** tab of this repository.
2. Click **"Report a vulnerability"** (GitHub Advisory form).
3. Fill in a description, affected component, steps to reproduce, and (if known) a suggested fix.

All reports are treated as confidential. We will not disclose the details publicly until a fix has been released.

If you cannot use the GitHub advisory form, email the maintainer directly through the contact listed on the repository profile.

## What to Include in Your Report

A useful report covers:

- A clear description of the vulnerability and its impact.
- The component(s) affected (frontend, backend, contracts, Docker configuration).
- Minimal steps or a proof-of-concept to reproduce the issue.
- Any environment details that matter (Node.js version, browser, OS).
- Suggested remediation if you have one.

## Response Timeline (SLA)

| Event                           | Target    |
| ------------------------------- | --------- |
| Initial acknowledgement         | 72 hours  |
| Triage and severity assessment  | 5 days    |
| Fix or mitigation released      | 30 days   |
| Public disclosure (coordinated) | After fix |

We follow [responsible disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure): details are made public only after a fix is available, in coordination with the reporter.

## Scope

Issues considered in scope:

- Authentication or authorization bypasses in the backend API.
- SQL injection or unsafe database queries in the Express layer.
- Secrets or credentials accidentally committed to the repository.
- Insecure handling of Stellar/Soroban transaction data.
- Cross-site scripting (XSS) or cross-site request forgery (CSRF) in the React frontend.
- Dependency vulnerabilities with a clear exploitation path in this project.

Out of scope:

- Vulnerabilities in upstream dependencies where no exploitation path exists in this project.
- Denial-of-service attacks requiring physical access or excessive resources.
- Social engineering.

## Secret Management & Rotation

### Handling Secrets

- **Never** commit secrets (API keys, Stellar secret keys, private keys) to the repository.
- Use environment variables for local development (kept in `.env`, which is ignored by git).
- Use GitHub Actions Secrets for CI/CD pipelines and production deployments.
- In production, use a secure secret manager (e.g., AWS Secrets Manager, HashiCorp Vault).

### Rotating Leaked Secrets

If a secret is accidentally committed:

1. **Rotate immediately**: Generate a new secret and update all systems using it.
2. **Invalidate the old secret**: Ensure the leaked secret can no longer be used.
3. **Scan history**: Use `gitleaks` or similar tools to ensure no other secrets are present.
4. **Purge history (optional but recommended)**: If the secret is highly sensitive, consider using `git-filter-repo` or BFG Repo-Cleaner to remove it from the git history. **Note**: This will rewrite history and requires coordination with the team.

## Security Best Practices for Contributors

- Never commit `.env` files, secret keys, or wallet private keys.
- Use `gitleaks` locally before pushing changes.
- Validate all user input at the API boundary (Zod schemas in `backend/src/validation/`).
- Keep dependencies up to date (`npm audit` before submitting a PR).
- Follow the principle of least privilege for any new API endpoints.

## Content Security Policy (CSP)

The frontend injects a **Content-Security-Policy-Report-Only** `<meta>` tag into
every page via a custom Vite plugin in `frontend/vite.config.ts`. In report-only
mode violations are logged to the browser console but **do not block** any
resources. Once validated in production, the policy can be switched to
enforcement mode.

### Active Directives

| Directive | Value | Purpose |
| ------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| `default-src` | `'none'` | Deny-by-default; every resource type must be listed |
| `script-src` | `'self'` | Only first-party scripts (no inline, no external CDN) |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | App CSS + React/Recharts inline styles + Google Fonts |
| `font-src` | `'self' https://fonts.gstatic.com` | Google Fonts font-file delivery |
| `img-src` | `'self' https: data:` | App images + user-submitted campaign images + data URIs |
| `connect-src` | `'self' https://soroban-testnet.stellar.org` | Backend API (`/api`) + Soroban testnet RPC |
| `frame-src` | `'none'` | No iframes required |
| `object-src` | `'none'` | No plugins (Flash, Java, etc.) |
| `base-uri` | `'self'` | Prevents `<base>` tag injection |
| `form-action` | `'self'` | Prevents form-action hijacking |

> **Note:** `frame-ancestors` is not supported in `<meta>` tags. For
> clickjacking protection via HTTP headers, add the `helmet` middleware to the
> Express backend in a future iteration.

### Dev-Mode Relaxations

During local development (`vite dev`), the plugin automatically detects dev mode
and relaxes two directives so Vite Hot Module Replacement (HMR) works:

- `script-src` adds `'unsafe-inline'` (Vite injects inline scripts for React
  Fast Refresh)
- `connect-src` adds `ws:` (Vite HMR uses WebSocket connections)

These relaxations are **not** included in production builds.

### Switching to Enforcement Mode

Once you have confirmed no legitimate resources are blocked in report-only mode
(check the browser console for `[Report Only]` violations):

1. Open `frontend/vite.config.ts`.
2. In the `cspMetaTagPlugin` function, change:
   ```ts
   `<meta http-equiv="Content-Security-Policy-Report-Only" ...>`
   ```
   to:
   ```ts
   `<meta http-equiv="Content-Security-Policy" ...>`
   ```
3. Rebuild and deploy.

### Adding a New Trusted Domain

To allow a new external resource (e.g., a new CDN or API endpoint):

1. Identify the correct directive (`script-src`, `style-src`, `connect-src`,
   etc.).
2. Add the domain to the corresponding array entry in the `directives` list
   inside `cspMetaTagPlugin()` in `frontend/vite.config.ts`.
3. Update the table above in this document.
4. Test in report-only mode before switching to enforcement.

## Automated Security Analysis

This project uses GitHub CodeQL for automated security analysis. The CodeQL workflow runs automatically on:

- Every push to the `main` branch
- All pull requests targeting `main`

### CodeQL Configuration

The security analysis workflow is defined in `.github/workflows/codeql-analysis.yml` and scans the codebase for:
- JavaScript and TypeScript security vulnerabilities
- Common security issues (prototype pollution, injection attacks, insecure deserialization)
- Code quality issues that could lead to security problems

### Viewing Security Alerts

Security alerts from CodeQL are surfaced in the **Security** tab of the repository. Contributors should:
- Review any security alerts that appear after their changes
- Address high or critical severity issues before merging
- Consider the security impact of any medium or low severity issues

The workflow uses the `security-extended` and `security-and-quality` query suites to provide comprehensive coverage of potential vulnerabilities.

---

## Self-Audit Checklist (Smart Contract / DeFi)

Use this checklist when reviewing the Soroban contract (`contracts/src/lib.rs`) or proposing changes that affect on-chain logic. Each item must be answered before merging.

### Reentrancy

| # | Check | Severity | Mitigation | Status |
|---|-------|----------|------------|--------|
| 1 | External token transfers occur **after** all state updates (checks-effects-interactions pattern) | **High** | Move `TokenClient::transfer()` calls after storage writes; or add a reentrancy guard if transfers must precede state changes | ☐ Open |
| 2 | Cross-contract calls do not allow the callee to re-enter and mutate contract state before the first invocation completes | **High** | Verify that Soroban's host-level call-depth limits are sufficient; add a `REENTRANCY_GUARD` flag stored in temporary storage if untrusted contracts are called | ☐ Open |
| 3 | `claim()` and `refund()` loops call external token contracts on each iteration without intermediate state snapshots | **Medium** | Consider batching transfers or taking a storage snapshot before the loop so a partial failure does not leave state inconsistent | ☐ Open |

### Access Control

| # | Check | Severity | Mitigation | Status |
|---|-------|----------|------------|--------|
| 4 | Admin address is immutable after `initialize()` | **Critical** | Already enforced — `DataKey::Admin` is set once and never updated; verify no `set_admin()` function is added in future PRs | ☐ Pass |
| 5 | Creator-only functions (`cancel_campaign`, `claim`, `update_metadata`) verify caller matches `campaign.creator` | **High** | Already enforced with `require_auth()` + identity comparison; ensure any new creator-gated function follows the same pattern | ☐ Pass |
| 6 | No function allows arbitrary address to withdraw funds from any campaign | **Critical** | `claim()` checks `campaign.creator`; `refund()` checks `contributor.require_auth()` and `HasContributed` key; verify no new withdrawal paths bypass these checks | ☐ Open |
| 7 | Pause mechanism excludes read-only functions to avoid denial-of-service on data reads | **Low** | Already enforced — `require_not_paused()` is called only in state-mutating entry points; verify any new `fn` with side effects does the same | ☐ Pass |

### Integer Overflow / Arithmetic

| # | Check | Severity | Mitigation | Status |
|---|-------|----------|------------|--------|
| 8 | `overflow-checks = true` is set in `Cargo.toml` release profile | **Critical** | Already present on line 27 of `contracts/Cargo.toml`; verify it is never removed or commented out | ☐ Pass |
| 9 | `pledged_amount + amount <= target_amount` guard prevents both overflow and over-funding | **High** | Already implemented at line 361 of `lib.rs`; verify similar guards exist for any new arithmetic in the contract | ☐ Open |
| 10 | Token amounts use `i128` (not `u64` or `u128`) to match Soroban token interface | **Medium** | Already using `i128` throughout; verify new fields also use `i128` and never cast without bounds checks | ☐ Pass |
| 11 | Multiplication before division (or vice versa) does not cause precision loss or overflow | **Medium** | Review any percentage or ratio calculations added in future; prefer `checked_mul().unwrap_or(i128::MAX)` for multiplications that could overflow | ☐ Open |
| 12 | `contributor_count += 1` (and similar counters) cannot overflow | **Low** | With `overflow-checks = true`, a panic would occur; consider using `saturating_add` if graceful handling is preferred over panic | ☐ Open |

### Flash Loan Attack Vectors

| # | Check | Severity | Mitigation | Status |
|---|-------|----------|------------|--------|
| 13 | Contract does not expose a "donate" or "deposit" function that manipulates internal price/balance snapshots used by other operations | **High** | Verify no function accepts tokens without recording a corresponding contribution or refund; flash loans rely on the ability to manipulate oracle-like state | ☐ Open |
| 14 | Campaign balance used for eligibility checks reflects actual token balance of the contract, not a stored snapshot | **Medium** | The contract tracks per-campaign token balances via `CampaignTokenBalance`; consider cross-referencing with `TokenClient::balance()` to prevent balance inflation attacks | ☐ Open |
| 15 | No governance or quorum function relies on a contributor's token balance that could be borrowed for a single transaction | **Medium** | `contributor_count` counts unique addresses (not balances), so flash-loaned tokens cannot inflate voting power; verify the same for any future governance features | ☐ Pass |

### Front-Running

| # | Check | Severity | Mitigation | Status |
|---|-------|----------|------------|--------|
| 16 | `create_campaign` parameters cannot be front-run to replace a legitimate campaign creation with a lookalike | **Medium** | `campaign_id` is a monotonically increasing `u32`, so an attacker can only create their own campaign with a predictable ID; no user-supplied ID exists | ☐ Pass |
| 17 | `claim()` cannot be front-run by an attacker to redirect funds | **High** | `claim()` transfers only to `campaign.creator` (verified via `require_auth()`); funds always go to the intended recipient regardless of transaction ordering | ☐ Pass |
| 18 | Deadline-dependent logic (`claim` vs `refund`) is not susceptible to validator timestamp manipulation | **Medium** | Soroban ledger timestamps are bounded by validator consensus; still, avoid tight time windows where a one-slot difference changes fund disposition | ☐ Open |
| 19 | `contribute()` race condition: two contributions arriving in the same block cannot jointly exceed `target_amount` | **Low** | Each contribution checks `pledged_amount + amount <= target_amount` independently; in practice the gap is bounded by one contribution. Acceptable for MVP | ☐ Open |

### Findings Register (Open Items)

| ID | Category | Finding | Severity | Mitigation | Assigned To | Due Date |
|----|----------|---------|----------|------------|-------------|----------|
| F-01 | Reentrancy | Token transfer precedes state update in `contribute()` — external call before storage write violates checks-effects-interactions | **High** | Swap the order: update `pledged_amount`, `contributor_count`, and per-contributor balance **before** calling `TokenClient::transfer()` | — | — |
| F-02 | Access Control | No two-step admin transfer mechanism exists | **Low** | If admin rotation is needed, implement a two-step pattern (propose + accept) to prevent accidental lockout | — | — |
| F-03 | Arithmetic | Counter increments use raw `+=` rather than `checked_add` | **Low** | With `overflow-checks=true` these will panic on overflow, which is acceptable; upgrade to `checked_add()` for explicit error handling if desired | — | — |

---

## External Audit Firm Template

Use this template when engaging an external security firm to audit the Soroban smart contract. Fill in the fields marked `[...]` before sending.

```markdown
# Audit Request: Stellar Goal Vault — Soroban Smart Contract

## Project Overview

- **Repository:** https://github.com/ritik4ever/stellar-goal-vault
- **Contract:** `contracts/src/lib.rs` — crowdfunding vault
- **Language / Framework:** Rust / Soroban SDK 21.0.0
- **Deployment Target:** Stellar Soroban (testnet → mainnet)
- **Commit Hash:** [GIT_COMMIT_HASH]
- **Prior Audits:** None

## Scope

### In-Scope Files

| File | LOC | Description |
|------|-----|-------------|
| `contracts/src/lib.rs` | ~828 | Main contract — campaign creation, contribution, claiming, refunding, cancellation, deadline extensions, pause, migrate |
| `contracts/src/test.rs` | ~1210 | Unit tests (optional: review test coverage quality) |

### Out of Scope

- Backend API (`backend/`)
- Frontend (`frontend/`)
- Docker / CI configuration
- JavaScript/TypeScript code

## Threat Model

### Assumed Attacker Capabilities

- Can submit arbitrary transactions to the Soroban network
- Can deploy their own Soroban contracts
- Can observe the mempool (subject to Soroban DAG ordering constraints)
- Does **not** control the Stellar validator set
- Does **not** have access to the contract admin key

### Critical Assets

| Asset | Description |
|-------|-------------|
| Campaign funds | Tokens held by the contract on behalf of campaign creators and contributors |
| Admin key | Controls `set_paused()` and `migrate()` — loss or compromise is critical |
| Campaign metadata integrity | Must not be arbitrarily overwritable |

## Focus Areas

Please prioritize the following vulnerability classes during the audit:

1. **Reentrancy** — Cross-contract calls during `contribute()`, `claim()`, and `refund()`; verify checks-effects-interactions pattern
2. **Access control** — Admin, creator, contributor boundaries; `require_auth()` usage
3. **Integer arithmetic** — Overflow, underflow, precision loss in `pledged_amount`, deadline calculations, contribution limits
4. **Flash loan resistance** — Any function that could be exploited with a single-transaction borrow-and-repay cycle
5. **Front-running / MEV** — Transaction ordering dependencies, deadline manipulation, race conditions in `contribute()` and `claim()`
6. **Fund safety** — Tokens cannot be permanently locked, stolen by non-creators, or claimed by unauthorized parties
7. **State consistency** — Idempotency of `migrate()`, correctness of `refund_all()` enumeration, dust handling

## Deliverables

### Required

- [ ] **Audit Report** — PDF or Markdown covering all findings with:
  - Title and description of each finding
  - Severity rating (Critical / High / Medium / Low / Informational)
  - Steps to reproduce or proof-of-concept
  - Recommended remediation
  - Code references (file + line number)
- [ ] **Status Summary** — Table of all findings with severity, status (Open / Acknowledged / Fixed / Verified), and verification commit hash
- [ ] **Re-Audit Letter** — After fixes are applied, a brief verification report confirming all high-severity items are resolved

### Nice-to-Have

- [ ] **Test Suite Recommendations** — Suggestions for property-based tests or fuzzing harnesses
- [ ] **Gas / Fee Optimization Notes** — Suggestions to reduce contract execution costs

## Timeline & Process

- **Audit Duration:** [e.g., 2 weeks]
- **Communication:** [e.g., Slack / Signal / Email]
- **Submission Method:** Private GitHub repository or encrypted email
- **Fix Verification:** After findings are addressed, one round of re-audit on the updated commit
- **Embargo Period:** Findings must not be publicly disclosed until [DATE] or until the fix has been deployed to mainnet

## Access

- [ ] Audit firm will be granted read-only access to a private fork or mirror of the repository
- [ ] CI/CD secrets and deployment credentials will **not** be shared
- [ ] No production data will be shared
- [ ] All communication will be encrypted

## Acceptance Criteria

This audit is considered complete when:

1. All in-scope files have been reviewed
2. Every finding has a severity rating and remediation recommendation
3. No **Critical** or **High** severity findings remain unresolved without an explicit risk acceptance
4. The re-audit letter confirms all fixes are correctly applied
5. The final report is delivered in the agreed format
```

---

## Audit Sign-Off

Before each production deployment, complete this sign-off:

```markdown
# Security Audit Sign-Off

**Deployment Tag:** [DEPLOYMENT_VERSION]
**Commit:** [GIT_COMMIT_HASH]
**Review Date:** [DATE]
**Reviewer:** [NAME]

## Self-Audit Checklist Sign-Off

All checklist items above have been reviewed:

- [ ] Reentrancy — no high-severity open items
- [ ] Access Control — no critical or high-severity open items
- [ ] Integer Overflow — overflow-checks enabled, no unsafe arithmetic introduced
- [ ] Flash Loan Vectors — no exploitable balance-manipulation paths
- [ ] Front-Running — no transaction-ordering dependencies with fund impact

## External Audit Status

- [ ] External audit has been completed for this scope
- [ ] All critical/high findings remediated and verified
- [ ] Risk acceptance documented for any remaining medium/low items

## Decision

☐ **Approved** — ready for deployment
☐ **Changes requested** — [link to required changes]
☐ **Blocked** — [reason]
```
