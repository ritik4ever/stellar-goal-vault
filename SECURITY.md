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
