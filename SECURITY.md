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
