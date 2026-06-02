# Changelog

All notable changes to Stellar Goal Vault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-05-27

### Added

- Campaign event history now records a `pledge_limit_reached` event when a campaign's pledge cap is hit.
- JSDoc comments across the codebase to improve contributor on-boarding.
- ESLint configuration for consistent code style enforcement.
- Soroban CI pipeline that builds and tests smart contracts on every pull request.
- Release-please automation to streamline version bumps and release notes.
- Docker health checks so orchestrators can detect unhealthy containers automatically.
- CSV export for campaign data, letting you download pledge records to a spreadsheet.
- `useLocalStorage` hook for persisting lightweight UI state across page refreshes.
- Bundle visualizer script to identify and reduce large JavaScript dependencies.
- Docker Compose override file for local development overrides without touching the main config.
- Security policy (`SECURITY.md`) documenting how to report vulnerabilities.
- Error boundaries that catch UI crashes and display a user-friendly fallback instead of a blank screen.
- Environment variable validation on startup so misconfigured deployments fail fast with a clear error.

### Fixed

- CI failures caused by a broken `main` branch state.

## [0.5.0] - 2026-04-29

### Added

- Campaign search API endpoint so you can find campaigns by keyword without scrolling through the full list.
- Campaign contributors summary showing each backer's address, total pledged, and refund status grouped in one view.
- Animated progress bar on the pledge panel that fills smoothly as contributions come in.
- Confetti effect when a campaign reaches its funding goal.
- Paginated pledge list endpoint — large campaigns no longer return an unbounded list of pledges.
- Multi-token campaign support, allowing campaigns to accept assets beyond XLM.
- Startup banner displayed in the terminal when the backend server boots.
- Wallet disconnect now syncs account state so the UI immediately reflects the logged-out user.
- Testnet faucet link in the developer footer for quick account funding during testing.
- GitHub Actions workflow that runs tests automatically on every pull request.
- Creator analytics cards showing total raised, backer count, and time remaining at a glance.
- API load-test script for measuring backend throughput before deploying to production.
- Minimum pledge enforcement — the contract and API now reject pledges below the configured floor.
- Contract CI check that verifies the Soroban contract compiles cleanly on each push.
- SQLite WAL mode enabled for better write concurrency under load.
- API integration tests covering the full campaign lifecycle (create → pledge → claim/refund).
- `CONTRIBUTING.md` guide explaining how to set up the project and submit pull requests.
- Deployment guide (`DEPLOYMENT.md`) with step-by-step production instructions.

### Fixed

- TypeScript and CSS build errors that blocked the production build.
- Pledge failure state now handled correctly in the frontend test suite.

## [0.4.0] - 2026-03-28

### Added

- Backend campaign search with full-text filtering across campaign titles and descriptions.
- Asset code filter on the `GET /api/campaigns` endpoint, letting you list only campaigns denominated in a specific token.
- Pagination on the campaign list endpoint so dashboards with many campaigns load quickly.
- Structured request logging middleware that records method, path, status, and duration for every API call.
- Blockchain metadata fields on campaigns to support future Soroban event sync.
- CORS allow-list restricting cross-origin requests to trusted origins.
- Health endpoint extended with database connectivity status and server uptime.

### Fixed

- Incomplete frontend code introduced by merge conflicts.
- Merged search and filter features that had conflicting implementations.

## [0.3.0] - 2026-03-27

### Added

- Reusable empty-state components shown when no campaigns exist or a search returns no results.
- Loading skeleton screens on the dashboard so layout does not jump while data loads.
- Soroban RPC event indexer that listens for on-chain events and keeps the local database in sync.
- Asset allowlist and campaign metadata support, restricting campaigns to approved Stellar assets.
- Optimistic pledge UI that updates the progress bar immediately while the transaction confirms, then reconciles with the server response.
- Contributor summary view grouping pledges by wallet address with active and refunded totals.
- Campaign share feature that syncs the selected campaign to the URL so you can send a direct link.
- Frontend tests covering the campaign creation and pledge flows.
- "Stellar Midnight" UI theme with glassmorphism cards, subtle animations, and improved empty states.
- TypeScript upgraded to 6.0.2 across the backend.

### Fixed

- All TypeScript and CSS build errors blocking the production bundle.
- Shared campaign links with invalid parameters now fall back gracefully instead of crashing.
- Pledge failure state handled correctly in the test suite.

## [0.2.0] - 2026-03-26

### Added

- API routes documentation listing all available endpoints with request and response shapes.
- Deployment guide with environment variable reference and step-by-step setup instructions.

## [0.1.0] - 2026-03-16

### Added

- React dashboard to create and manage funding campaigns.
- Campaign board, detail panel, timeline, and contribution backlog.
- Node.js + Express REST API backed by SQLite.
- Soroban smart contract scaffold supporting campaign creation, pledging, claiming, and refunding.
- Freighter wallet integration for signing and submitting Stellar transactions from the browser.
- Campaign goal and deadline enforcement — creators can claim only if the goal is met; contributors can refund only if it is not.
- Seeded contribution backlog ready to convert into GitHub issues for community contributors.

[Unreleased]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ritik4ever/stellar-goal-vault/releases/tag/v0.1.0
