# Stellar Goal Vault — Documentation Index

A map of every documentation file in the repository, organized by topic. Use this as your starting point to find the right document for any task.

---

## Quick Start

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Project overview, architecture summary, setup, environment variables |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup guide, workflow, and PR process for contributors |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deploying to testnet (contract), Render (backend), Vercel (frontend) |
| [FAQ.md](FAQ.md) | Common questions: testnet XLM, Freighter setup, pledge failures |

---

## Architecture & Design

| Document | Description |
|----------|-------------|
| [docs/architecture.md](docs/architecture.md) | Mermaid sequence diagrams: pledge, claim, refund, event reconciliation |
| [docs/soroban-rpc.md](docs/soroban-rpc.md) | Soroban RPC interaction pattern: simulate → sign → submit → reconcile |
| [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md) | ASCII diagrams of integration test suite architecture |
| [MULTI_TOKEN_DESIGN_DECISION.md](MULTI_TOKEN_DESIGN_DECISION.md) | Design exploration for multi-token campaign support |

### Architecture Decision Records (ADRs)

| Document | Description |
|----------|-------------|
| [adr/0001-sqlite-off-chain-mvp.md](adr/0001-sqlite-off-chain-mvp.md) | SQLite for off-chain MVP persistence |
| [adr/0002-react-express-mvp.md](adr/0002-react-express-mvp.md) | React + Vite frontend, Express + SQLite backend |
| [adr/0003-freighter-wallet-integration.md](adr/0003-freighter-wallet-integration.md) | Freighter as sole wallet signing mechanism |

---

## Smart Contract (Soroban / Rust)

| Document | Description |
|----------|-------------|
| [contracts/QUICKSTART.md](contracts/QUICKSTART.md) | Running property-based tests on the Soroban contract |
| [contracts/PROPERTY_TESTS.md](contracts/PROPERTY_TESTS.md) | 5 property-based invariant tests: funding, refunds, state consistency |
| [contracts/BASELINE_COSTS.md](contracts/BASELINE_COSTS.md) | CPU instruction cost baseline per entry point |
| [contracts/BENCHMARKS.md](contracts/BENCHMARKS.md) | WASM binary size, instruction counts, optimization results |

---

## Backend (Express / SQLite)

| Document | Description |
|----------|-------------|
| [backend/REQUEST_LOGGING.md](backend/REQUEST_LOGGING.md) | Request logging middleware: format, safety, output modes |
| [backend/PRODUCTION_FEATURES.md](backend/PRODUCTION_FEATURES.md) | API key auth, rate limiting, CORS configuration |
| [backend/tests/README.md](backend/tests/README.md) | Integration test suite: how to run, scenarios, troubleshooting |
| [backend/tests/SETUP.md](backend/tests/SETUP.md) | Integration test architecture, database isolation, CI/CD |
| [backend/tests/IMPLEMENTATION.md](backend/tests/IMPLEMENTATION.md) | Integration test implementation: 770+ lines, 70+ assertions |

### Backend Test Docs (Quick Access)

| Document | Description |
|----------|-------------|
| [INTEGRATION_TESTS_SUMMARY.md](INTEGRATION_TESTS_SUMMARY.md) | Quick-start guide to the integration test suite (5 min) |
| [ARCHITECTURE_DIAGRAMS.md](ARCHITECTURE_DIAGRAMS.md) | Visual design of the test suite architecture |
| [DELIVERABLES.md](DELIVERABLES.md) | Complete file inventory and verification checklist |

---

## Frontend (React / Vite)

| Document | Description |
|----------|-------------|
| [frontend/TESTING.md](frontend/TESTING.md) | Frontend testing setup, running tests, coverage overview |
| [frontend/PERFORMANCE.md](frontend/PERFORMANCE.md) | Bundle analysis, code-splitting strategy, vendor chunks |
| [frontend/IMPLEMENTATION_MANIFEST.md](frontend/IMPLEMENTATION_MANIFEST.md) | Search feature implementation: hooks, components, API |
| [frontend/src/components/TESTING.md](frontend/src/components/TESTING.md) | Component-level testing: CreateCampaignForm, CampaignDetailPanel |
| [frontend/src/components/SEARCH_FEATURE_GUIDE.md](frontend/src/components/SEARCH_FEATURE_GUIDE.md) | Search feature deep-dive: useDebounce, SearchInput, filtering |
| [frontend/src/components/CREATE_CAMPAIGN_FORM_TEST_SUMMARY.md](frontend/src/components/CREATE_CAMPAIGN_FORM_TEST_SUMMARY.md) | CreateCampaignForm test coverage (400+ lines, 3 test files) |

---

## Security

| Document | Description |
|----------|-------------|
| [SECURITY.md](SECURITY.md) | Vulnerability disclosure policy, CSP, secret management, CodeQL |
| [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) | OWASP Top-10 review checklist mapped to codebase areas |

---

## Operations & Deployment

| Document | Description |
|----------|-------------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Contract (testnet), backend (Render), frontend (Vercel) deployment |
| [RUNBOOK.md](RUNBOOK.md) | Operations: database reset, API key rotation, contract redeploy, rollback |
| [TODO.md](TODO.md) | Pending implementation: contributor summary endpoint |

---

## Feature Documentation

| Document | Description |
|----------|-------------|
| [CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md](CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md) | Four campaign lifecycle events: created, pledged, claimed, refunded |
| [EVENT_METADATA_DOCUMENTATION.md](EVENT_METADATA_DOCUMENTATION.md) | Blockchain metadata fields on events: txHash, ledgerNumber |
| [SEARCH_FEATURE_DELIVERY.md](SEARCH_FEATURE_DELIVERY.md) | Campaign search feature: debounce hook, search input, filtering |
| [VALIDATION_SUMMARY.md](VALIDATION_SUMMARY.md) | Frontend validation: 50+ test cases, real-time validation |
| [VALIDATION_IMPLEMENTATION.md](VALIDATION_IMPLEMENTATION.md) | Frontend validation implementation details |
| [CAMPAIGN_FORM_TESTING_COMPLETE.md](CAMPAIGN_FORM_TESTING_COMPLETE.md) | Campaign form testing completion report |
| [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | Contract property-based tests for funding invariants |
| [PROPERTY_TESTS_IMPLEMENTATION.md](PROPERTY_TESTS_IMPLEMENTATION.md) | 5 property-based invariant tests: implementation report |
| [PROPERTY_TESTS_VERIFICATION.md](PROPERTY_TESTS_VERIFICATION.md) | Property-based test verification guide |

---

## GitHub Templates

| Document | Description |
|----------|-------------|
| [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) | PR template with change descriptions, testing, security review |
| [.github/ISSUE_TEMPLATE/bug_report.md](.github/ISSUE_TEMPLATE/bug_report.md) | Bug report template: description, steps, environment |
| [.github/ISSUE_TEMPLATE/feature_request.md](.github/ISSUE_TEMPLATE/feature_request.md) | Feature request template: problem, solution, alternatives |
| [.github/ISSUE_TEMPLATE/contribution-task.md](.github/ISSUE_TEMPLATE/contribution-task.md) | Contribution task template for scoped open-source issues |

---

## Changelog & Project History

| Document | Description |
|----------|-------------|
| [CHANGELOG.md](CHANGELOG.md) | Full release history (Keep a Changelog format) |
| [OPEN_SOURCE_ISSUES.md](OPEN_SOURCE_ISSUES.md) | Curated contribution issues: Freighter signing, Soroban event sync |
| [PR_DESCRIPTION.md](PR_DESCRIPTION.md) | Initial MVP PR description |
| [pr-body.md](pr-body.md) | PR body template (progress bar animation) |

---

*Last updated: 2026-07-29*
