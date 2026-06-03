# Changelog

All notable changes to Stellar Goal Vault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 (2026-06-03)


### Features

* [#116](https://github.com/ritik4ever/stellar-goal-vault/issues/116) Add API Integration Tests For Campaign Lifecycle ([cb62b3a](https://github.com/ritik4ever/stellar-goal-vault/commit/cb62b3affbd636dc992fc85138f27283ce7799c1))
* [#17](https://github.com/ritik4ever/stellar-goal-vault/issues/17) Add Asset Filtering To GET /api/campaigns ([01713bd](https://github.com/ritik4ever/stellar-goal-vault/commit/01713bd275ae9411ecd9c64a1c9bb793725f08a8))
* **#327:** add Soroban transaction fee estimation before pledge ([8229c34](https://github.com/ritik4ever/stellar-goal-vault/commit/8229c344bf96151d3f14d555b884ebf6f92c1c1f)), closes [#327](https://github.com/ritik4ever/stellar-goal-vault/issues/327)
* add 80% vitest line coverage gate and artifact automation to CI ([df360bd](https://github.com/ritik4ever/stellar-goal-vault/commit/df360bde4f67d4a61d60c397893e25da16e7c798))
* add asset code filter for campaign discovery ([49cd3a1](https://github.com/ritik4ever/stellar-goal-vault/commit/49cd3a1ee781c256e68820f7896f2c5d55931220))
* add backend search functionality for campaigns ([f77d88a](https://github.com/ritik4ever/stellar-goal-vault/commit/f77d88a817af9333094e82cfc6c2a19fcad62927))
* add batch_refund function for failed campaigns ([13d9997](https://github.com/ritik4ever/stellar-goal-vault/commit/13d99973b76f9358763facd265eb297ffbdd0565)), closes [#114](https://github.com/ritik4ever/stellar-goal-vault/issues/114)
* add blockchain metadata support for future Soroban sync ([d21f704](https://github.com/ritik4ever/stellar-goal-vault/commit/d21f70431fcab58569beb27776b65b161236a8d3))
* add bundle visualizer, useLocalStorage, CSV export, and docker health checks ([a34a6b4](https://github.com/ritik4ever/stellar-goal-vault/commit/a34a6b4a29fd77c262e055e988af45e4159c354a))
* add campaign contributors summary ([e4a3c97](https://github.com/ritik4ever/stellar-goal-vault/commit/e4a3c97b5d4fae059bbe60072d6d6dc2cd90e3b6))
* add campaign goal edit endpoint for creators ([bcb33a1](https://github.com/ritik4ever/stellar-goal-vault/commit/bcb33a15ea8b82f515931e4107504182e9075d29))
* add campaign permalink routes via React Router ([699925f](https://github.com/ritik4ever/stellar-goal-vault/commit/699925f7d7d0ce6ea5ef8639fa0354655ca98e41))
* add campaign search api ([d5b7583](https://github.com/ritik4ever/stellar-goal-vault/commit/d5b75835405f28f334d4ca0fb1b5fa9ee602b5b0))
* add campaign share button ([faae957](https://github.com/ritik4ever/stellar-goal-vault/commit/faae9577976e480e9d7363583e4d4ec13ad602c8))
* Add Confetti Effect When Campaign Reaches Goal ([d90650f](https://github.com/ritik4ever/stellar-goal-vault/commit/d90650ff33ce05ffe2cd37cc48c57c0bd40ebc37))
* add docker override, security policy, error boundaries, and env validation ([67470f5](https://github.com/ritik4ever/stellar-goal-vault/commit/67470f5291b20e13542680d7953148ba55924f6a))
* add frontend tests for create and pledge flows ([4a4db86](https://github.com/ritik4ever/stellar-goal-vault/commit/4a4db86ab4c9b9e95caa3a912380f5f7774459a0))
* add get_contributor_count function ([922a5a0](https://github.com/ritik4ever/stellar-goal-vault/commit/922a5a0ca932b7150b9cea64b9d08c232c7ee72d))
* add GitHub Actions CI workflow for backend, frontend, and contract builds ([b023358](https://github.com/ritik4ever/stellar-goal-vault/commit/b02335805ac20893aa4dfa284ab611ca0a2627ef))
* add JSDoc, ESLint, Soroban CI, and release-please automation ([de33dce](https://github.com/ritik4ever/stellar-goal-vault/commit/de33dce99b926b5252ef0572c9c985eb19f2c190))
* add keyboard shortcuts help overlay with global key bindings ([b364c17](https://github.com/ritik4ever/stellar-goal-vault/commit/b364c170ae8757705f99fd3a286669076bd5506d))
* add paginated campaign pledge list endpoint ([6186fe2](https://github.com/ritik4ever/stellar-goal-vault/commit/6186fe203aab09ba4a38f473c31ac1088f27303e))
* add per-contributor pledge limit per campaign ([c9b51d0](https://github.com/ritik4ever/stellar-goal-vault/commit/c9b51d00e54c55df603d806eb436dca5b80a0db9))
* add property-based tests for funding invariants ([369b8d9](https://github.com/ritik4ever/stellar-goal-vault/commit/369b8d9aa2af8cae87081ace413fbfa0558493ce))
* add soft delete support for campaigns ([c600d00](https://github.com/ritik4ever/stellar-goal-vault/commit/c600d00d7573010149dd8ccb01cd1d72e82ed9ae))
* add Soroban RPC event indexer, fix all build errors, and ensure robust backend/frontend integration ([5bc98e1](https://github.com/ritik4ever/stellar-goal-vault/commit/5bc98e1ecfc96127e699be395d99fc4a08917fb1))
* add stellar goal vault MVP ([bcfaa43](https://github.com/ritik4ever/stellar-goal-vault/commit/bcfaa4391da8f1be251e152e551b1aa0454efc77))
* add Storybook for shared UI components ([b5547ef](https://github.com/ritik4ever/stellar-goal-vault/commit/b5547ef94409bb87aa2ebf6dbd5624866f1bd588)), closes [#274](https://github.com/ritik4ever/stellar-goal-vault/issues/274)
* add StrKey checksum validation for Stellar address fields ([2c12133](https://github.com/ritik4ever/stellar-goal-vault/commit/2c121332d8a2f7825ce4e85158c6f98053e8daf2))
* add Stryker mutation testing for campaignStore and eventHistory ([56f2f0e](https://github.com/ritik4ever/stellar-goal-vault/commit/56f2f0ea9a2253dcff698efcefb4085470bae5d4)), closes [#317](https://github.com/ritik4ever/stellar-goal-vault/issues/317)
* add testnet faucet link to dev footer ([00347fb](https://github.com/ritik4ever/stellar-goal-vault/commit/00347fb8d82b7f390d6c526d428c2c625f5bad23))
* Add validated status query parameter to campaign list endpoint with server-side filtering ([1f3f210](https://github.com/ritik4ever/stellar-goal-vault/commit/1f3f210f539b1671826bb1cb2d32aaf480e73065))
* add wallet disconnect button and Freighter account sync ([32fd775](https://github.com/ritik4ever/stellar-goal-vault/commit/32fd77579ffebd56559341a2f0e91478734aeabf))
* **backend:** add response compression middleware (gzip/br) to Express ([a42a740](https://github.com/ritik4ever/stellar-goal-vault/commit/a42a740b264234548b96f7e3b49d1ce4606b7578))
* **backend:** add structured json logging ([52dee55](https://github.com/ritik4ever/stellar-goal-vault/commit/52dee5542ebc204e7cd916043fca3d91733041fb))
* **backend:** add structured request logging middleware ([91c1421](https://github.com/ritik4ever/stellar-goal-vault/commit/91c14218b49f93ae2120fcde8931819c22a01458))
* **backend:** optimize campaignStore list query with single SQL join ([eee0256](https://github.com/ritik4ever/stellar-goal-vault/commit/eee025657ff4ddb5cc5b7d35d09cd28699d5b80e))
* close CampaignDetailPanel on Escape and restore focus ([9b98872](https://github.com/ritik4ever/stellar-goal-vault/commit/9b98872185004c9c6068ef02522bb801f70e3392))
* close CampaignDetailPanel on Escape and restore focus ([e4ddd64](https://github.com/ritik4ever/stellar-goal-vault/commit/e4ddd641133a3d748bb23016bfdab74d6f623256))
* docs: document soroban RPC flow ([f4f542f](https://github.com/ritik4ever/stellar-goal-vault/commit/f4f542ffd7c8e123d7b0f31d14e58a4e7bc885aa))
* feat: sync selected campaign to URL query param with graceful fallback for invalid shared links ([832aba8](https://github.com/ritik4ever/stellar-goal-vault/commit/832aba8c17fa9bccf820bbd55b53c977ebc1a3aa))
* frontend yml github action ([7ecf568](https://github.com/ritik4ever/stellar-goal-vault/commit/7ecf568cc1a4ed03b0dee18507f5cc78ba54469a))
* **frontend:** add Content-Security-Policy meta tag for build ([#304](https://github.com/ritik4ever/stellar-goal-vault/issues/304)) ([0fa2ce2](https://github.com/ritik4ever/stellar-goal-vault/commit/0fa2ce26bde5591f90b677647e5a616016476f97))
* **frontend:** add dark mode toggle with theme persistence and UI updates ([e07ab5c](https://github.com/ritik4ever/stellar-goal-vault/commit/e07ab5cc9bf67681bb2e48f305568297eeed8a79))
* **frontend:** add lazy loading, CDN proxy, and placeholder for campaign images ([ff90ea5](https://github.com/ritik4ever/stellar-goal-vault/commit/ff90ea5c00a5f570254cfb4994a1de55b4e66b71))
* **frontend:** add pledge confirmation modal to CampaignDetailPanel ([1af8f94](https://github.com/ritik4ever/stellar-goal-vault/commit/1af8f944c1c988562a73118698a0a76097cdd5b0))
* **frontend:** add service worker for offline-first campaign list caching ([9ecf1bd](https://github.com/ritik4ever/stellar-goal-vault/commit/9ecf1bdc6d34f3c39eb7dec565d30368e86ffde6))
* **frontend:** add status tabs with counts for campaign filtering ([07249f1](https://github.com/ritik4ever/stellar-goal-vault/commit/07249f1939be8a7487a6ec37927ebb2a35965a5e)), closes [#77](https://github.com/ritik4ever/stellar-goal-vault/issues/77)
* **frontend:** add toast notification system for action feedback ([c04e65e](https://github.com/ritik4ever/stellar-goal-vault/commit/c04e65ee0c816a9a463ae1769d61bdd5300fa43c))
* **frontend:** integrate Freighter pledge flow ([695d0cd](https://github.com/ritik4ever/stellar-goal-vault/commit/695d0cd538e949e98ac12a6ac57bd1c411d641e4))
* **frontend:** lazy-load CampaignDetailPanel and CreatorAnalytics with React.lazy ([b28d2f7](https://github.com/ritik4ever/stellar-goal-vault/commit/b28d2f7ff7feba907e02237fe5a446e55f56ac65))
* GitHub Actions PR Test Workflow ([4eeceaf](https://github.com/ritik4ever/stellar-goal-vault/commit/4eeceaf326c98298faad0623ff7ad7b0442f3045))
* Implement a new "Stellar Midnight" UI theme with glassmorphism, animations, and empty states for improved aesthetics and user experience. ([b67372f](https://github.com/ritik4ever/stellar-goal-vault/commit/b67372f30cee6b79a8d70c986fe56ccac6895587))
* implement asset allowlist and campaign metadata support ([4e925c4](https://github.com/ritik4ever/stellar-goal-vault/commit/4e925c415744538ba2d108bade1a320aa2ef4bbf))
* Implement comprehensive frontend validation for Create Campaign Form ([909426c](https://github.com/ritik4ever/stellar-goal-vault/commit/909426ce485d37cdb561ffc191b49c06832daf83))
* implement frontend foundation and Freighter wallet integration for campaign management ([06f0a7d](https://github.com/ritik4ever/stellar-goal-vault/commit/06f0a7d2861cd1e5f2d8dd1098ed2a146b0500f3))
* **ui:** implement virtual scrolling for campaign list ([8d7588b](https://github.com/ritik4ever/stellar-goal-vault/commit/8d7588bba7b317191f8d2039a31bca24b4478341)), closes [#324](https://github.com/ritik4ever/stellar-goal-vault/issues/324)


### Bug Fixes

* add contract version storage and getter ([4fb0a61](https://github.com/ritik4ever/stellar-goal-vault/commit/4fb0a6177f4b3bd146afb0b9d0ea043468ccccf0))
* **api:** restrict JSON body size to 16kb to prevent memory exhaustion ([25fe47c](https://github.com/ritik4ever/stellar-goal-vault/commit/25fe47c77762b3963daa0376207a1fd1ebd2efcd)), closes [#307](https://github.com/ritik4ever/stellar-goal-vault/issues/307)
* **ci:** repair backend dependency and frontend build ([c30ff50](https://github.com/ritik4ever/stellar-goal-vault/commit/c30ff504ebbea698c8099db6cd07ed70e1e05c95))
* complete incomplete frontend code from merge conflicts ([7033e59](https://github.com/ritik4ever/stellar-goal-vault/commit/7033e59f226a0632f70d0efcaa855c99641d49e8))
* handle pledge failure state in tests ([70bd712](https://github.com/ritik4ever/stellar-goal-vault/commit/70bd7126c38b26d32a43251b5b074e778ee62cce))
* pin @vitest/coverage-v8 to 1.6.1 and move coverage config to vite.config.ts ([86a2f14](https://github.com/ritik4ever/stellar-goal-vault/commit/86a2f14338eafaf6822efd246c0d0594c60ed972))
* resolve all TypeScript and CSS build errors ([c9cae85](https://github.com/ritik4ever/stellar-goal-vault/commit/c9cae858640952e933cc0a2f8688a886bccfc81d))
* resolve CI failures from broken main branch state ([cd3cd7e](https://github.com/ritik4ever/stellar-goal-vault/commit/cd3cd7e84b4793227802f2b6be56a96306ebad7b))
* resolve compilation errors and finalize request logging middleware [#21](https://github.com/ritik4ever/stellar-goal-vault/issues/21) ([ca0eb7e](https://github.com/ritik4ever/stellar-goal-vault/commit/ca0eb7e5527bc0cc391d9d275a69338433df1a5c))
* resolve issues [#301](https://github.com/ritik4ever/stellar-goal-vault/issues/301), [#302](https://github.com/ritik4ever/stellar-goal-vault/issues/302), [#309](https://github.com/ritik4ever/stellar-goal-vault/issues/309) — templates, audit gates, SRI check ([8f00af2](https://github.com/ritik4ever/stellar-goal-vault/commit/8f00af2c89a35004efe77ec2d11efe747a3ff99a))
* resolve merge conflicts and integrate search with filters ([5508493](https://github.com/ritik4ever/stellar-goal-vault/commit/5508493c2d08028439bd70cb310d2b0bac748a13))
* **theme:** persist dark mode across reloads and prevent FOUC ([6056016](https://github.com/ritik4ever/stellar-goal-vault/commit/60560161313ab1a93e4f1615ab76ee5ed0f89d78))

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
