# Deliverables

Current implementation status for the Stellar Goal Vault project.
Last updated: 2026-07-29

---

## Backend API

### Core Server

- [x] Express 5 application with TypeScript — `backend/src/index.ts`
- [x] Structured request logging — `backend/src/logger.ts`
- [x] Request context propagation — `backend/src/requestContext.ts`
- [x] Environment variable validation on startup — `backend/src/validateEnv.ts`
- [x] OpenAPI spec generation (zod-to-openapi) — `backend/src/openapi.ts`

### Campaign Service

- [x] Campaign CRUD + state machine logic — `backend/src/services/campaignStore.ts`
- [x] LRU caching layer — `backend/src/services/campaignCache.ts`
- [x] Event history tracking — `backend/src/services/eventHistory.ts`
- [x] Soroban RPC event indexer — `backend/src/services/eventIndexer.ts`
- [x] SQLite database with WAL mode — `backend/src/services/db.ts`
- [x] Deterministic data seeding — `backend/src/services/seedDeterministic.ts`

### API Endpoints

- [x] Campaign CRUD (create, read, list, update)
- [x] Pledge/contribute endpoint
- [x] Claim endpoint
- [x] Refund endpoint
- [x] Search with pagination and asset filter
- [x] Campaign stats endpoint
- [x] Health endpoint with DB status
- [x] Contributors summary endpoint (backend)
- [x] Event history endpoint

### Middleware

- [x] API key authentication — `backend/src/middleware/apiKeyAuth.ts`
- [x] Response caching — `backend/src/middleware/cacheMiddleware.ts`
- [x] Request ID injection — `backend/src/middleware/requestId.ts`
- [x] Request body validation (zod) — `backend/src/middleware/validateBody.ts`

### Validation

- [x] Zod schemas for all endpoints — `backend/src/validation/schemas.ts`
- [x] Stellar address validation — `backend/src/validation/stellarAddress.ts`
- [x] URL safety checks — `backend/src/validation/urlSafety.ts`

---

## Frontend

### Core UI

- [x] React 18 + Vite 5 + TypeScript 5 — `frontend/`
- [x] Tailwind CSS 3 styling — `frontend/src/index.css`
- [x] React Router 6 navigation — `frontend/src/App.tsx`
- [x] PWA support (service worker) — `frontend/src/sw.ts`

### Components (40+)

- [x] CampaignCard — campaign list cards
- [x] CampaignDetailPanel — campaign detail view
- [x] CampaignsTable — virtualized campaign table (@tanstack/react-virtual)
- [x] CampaignTimeline — campaign event timeline
- [x] CreateCampaignForm — campaign creation form
- [x] ContributorSummary — contributor breakdown
- [x] CreatorAnalytics — creator dashboard analytics (recharts)
- [x] TransactionPreviewModal — transaction preview before signing
- [x] WalletWidget — Freighter wallet connection
- [x] SearchInput — campaign search
- [x] SortDropdown — sort controls
- [x] EmptyState — empty state illustrations
- [x] ErrorBoundary — React error boundaries
- [x] SkeletonCard — loading skeletons
- [x] ToastContainer — notification toasts
- [x] CopyButton — clipboard copy utility
- [x] FundedConfetti — celebration animation
- [x] IssueBacklog — open-source issue display
- [x] KeyboardShortcutsOverlay — keyboard shortcuts
- [x] NotFoundPage — 404 page

### Services

- [x] API client — `frontend/src/services/api.ts`
- [x] HTTP client — `frontend/src/services/httpClient.ts`
- [x] Freighter wallet integration — `frontend/src/services/freighter.ts`
- [x] Soroban SDK integration — `frontend/src/services/soroban.ts`

### Hooks

- [x] useFreighter — wallet state management
- [x] useMediaQuery — responsive breakpoints
- [x] useToast — toast notifications
- [x] useLocalStorage — persistent state
- [x] useDebounce — input debouncing

### Utilities

- [x] Input validation — `frontend/src/utils/validation.ts`
- [x] CSV export — `frontend/src/utils/exportCsv.ts`
- [x] Funding celebration effects — `frontend/src/lib/fundingCelebration.ts`
- [x] Keyboard shortcut definitions — `frontend/src/lib/shortcuts.ts`

---

## Soroban Smart Contract

- [x] Campaign lifecycle (create, contribute, claim, refund) — `contracts/src/lib.rs`
- [x] Initialize with min contribution — `contracts/src/lib.rs`
- [x] Update metadata — `contracts/src/lib.rs`
- [x] Request deadline extension — `contracts/src/lib.rs`
- [x] Approve extension — `contracts/src/lib.rs`
- [x] Cancel campaign — `contracts/src/lib.rs`
- [x] Pause/unpause — `contracts/src/lib.rs`
- [x] State migration — `contracts/src/lib.rs`
- [x] Contract unit tests — `contracts/src/test.rs`
- [x] 50+ test snapshots — `contracts/test_snapshots/`
- [x] Deployment script — `scripts/deploy.sh`
- [x] TypeScript bindings generator — `scripts/gen-bindings.ts`

---

## Testing

### Backend Unit Tests (20 files)

- [x] API endpoint tests — `backend/src/api.test.ts`, `index.test.ts`
- [x] Campaign store tests — `backend/src/services/campaignStore.test.ts`
- [x] Concurrent campaign store tests — `backend/src/services/campaignStore.concurrent.test.ts`
- [x] Campaign cache tests — `backend/src/services/campaignCache.test.ts`
- [x] Database WAL tests — `backend/src/services/db.wal.test.ts`
- [x] Seed deterministic tests — `backend/src/services/seedDeterministic.test.ts`
- [x] Middleware tests — `validateBody.test.ts`, `requestId.test.ts`
- [x] Validation tests — `schemas.test.ts`, `stellarAddress.test.ts`, `urlSafety.test.ts`
- [x] Logger tests — `backend/src/logger.test.ts`
- [x] OpenAPI tests — `backend/src/openapi.test.ts`
- [x] Security tests — `backend/src/security.test.ts`
- [x] Rate limiter tests — `backend/src/rateLimiter.test.ts`
- [x] Event metadata tests — `backend/src/services/__tests__/eventMetadata.test.ts`
- [x] Mutation tests (Stryker) — `backend/src/services/__tests__/mutation.test.ts`

### Frontend Tests (38 files)

- [x] Component unit tests — `frontend/src/components/*.test.tsx`
- [x] Accessibility tests (vitest-axe) — `frontend/src/components/*.a11y.test.tsx`
- [x] Hook tests — `frontend/src/hooks/*.test.ts`
- [x] Service tests — `frontend/src/services/*.test.ts`
- [x] Utility tests — `frontend/src/utils/*.test.ts`
- [x] Integration tests — `frontend/src/components/CampaignsTable.integration.test.tsx`

### E2E Tests (Playwright)

- [x] Campaign lifecycle spec — `e2e/campaign-lifecycle.spec.ts`
- [x] Campaign card visual regression — `e2e/campaign-card.visual.spec.ts`
- [x] Dashboard page object — `e2e/dashboard.ts`
- [x] Playwright config — `playwright.config.ts`
- [x] Visual regression config — `playwright.visual.config.ts`

### Integration Tests

- [x] Test utilities (mock data, API helpers, assertions) — `backend/tests/utils.ts` (335 lines)
- [ ] Backend integration test suite — `backend/tests/integration.test.ts` (empty, 0 lines)

---

## CI/CD

### GitHub Actions Workflows (16)

- [x] Main CI pipeline — `.github/workflows/ci.yml`
- [x] PR test runner — `.github/workflows/pr-tests.yml`
- [x] Backend CI — `.github/workflows/backend.yml`
- [x] Frontend CI — `.github/workflows/frontend.yml`
- [x] Backend integration tests workflow — `.github/workflows/backend-integration-tests.yml`
- [x] Soroban contract build & test — `.github/workflows/contracts-ci.yml`
- [x] ABI bindings freshness check — `.github/workflows/check-bindings.yml`
- [x] Playwright E2E — `.github/workflows/playwright-e2e.yml`
- [x] Visual regression — `.github/workflows/playwright-visual-regression.yml`
- [x] Lighthouse CI — `.github/workflows/lighthouse-ci.yml`
- [x] Storybook build/deploy — `.github/workflows/storybook.yml`
- [x] Load testing — `.github/workflows/load-test.yml`
- [x] CodeQL security scanning — `.github/workflows/codeql-analysis.yml`
- [x] Gitleaks secret detection — `.github/workflows/gitleaks.yml`
- [x] Docker GHCR publish — `.github/workflows/publish-ghcr.yml`
- [x] Release-please automation — `.github/workflows/release.yml`

### Supporting Config

- [x] Dependabot — `.github/dependabot.yml`
- [x] Issue templates — `.github/ISSUE_TEMPLATE/`
- [x] PR template — `.github/PULL_REQUEST_TEMPLATE.md`

---

## Infrastructure

- [x] Docker Compose (dev + prod) — `docker-compose.yml`, `docker-compose.override.yml`
- [x] Backend Dockerfile — `backend/dockerfile`
- [x] Frontend Dockerfile — `frontend/dockerfile`
- [x] Nginx reverse proxy — `nginx/`
- [x] Release-please config — `release-please-config.json`
- [x] Benchmarking script — `scripts/benchmark.sh`
- [x] SRI check script — `scripts/check-sri.sh`

---

## Documentation

### Core Docs

- [x] Project README — `README.md` (574 lines)
- [x] Changelog — `CHANGELOG.md` (v0.1.0 through v0.6.0)
- [x] Contributing guide — `CONTRIBUTING.md`
- [x] Security policy — `SECURITY.md`
- [x] Security checklist — `SECURITY_CHECKLIST.md`
- [x] Deployment guide — `DEPLOYMENT.md`
- [x] Operations runbook — `RUNBOOK.md`
- [x] FAQ — `FAQ.md`

### Technical Docs

- [x] Architecture Mermaid diagrams — `docs/architecture.md`
- [x] Soroban RPC docs — `docs/soroban-rpc.md`
- [x] Architecture Decision Records — `adr/0001-sqlite-off-chain-mvp.md`, `0002-react-express-mvp.md`, `0003-freighter-wallet-integration.md`
- [x] Campaign lifecycle implementation — `CAMPAIGN_LIFECYCLE_IMPLEMENTATION.md`
- [x] Multi-token design decision — `MULTI_TOKEN_DESIGN_DECISION.md`
- [x] Event metadata documentation — `EVENT_METADATA_DOCUMENTATION.md`
- [x] Validation implementation — `VALIDATION_IMPLEMENTATION.md`, `VALIDATION_SUMMARY.md`

### Testing Docs

- [x] Integration tests summary — `INTEGRATION_TESTS_SUMMARY.md`
- [x] Architecture diagrams — `ARCHITECTURE_DIAGRAMS.md`
- [x] Backend test README — `backend/tests/README.md`
- [x] Backend test setup — `backend/tests/SETUP.md`
- [x] Backend test implementation — `backend/tests/IMPLEMENTATION.md`
- [x] Property tests implementation — `PROPERTY_TESTS_IMPLEMENTATION.md`
- [x] Property tests verification — `PROPERTY_TESTS_VERIFICATION.md`
- [x] Campaign form testing complete — `CAMPAIGN_FORM_TESTING_COMPLETE.md`

### Feature Docs

- [x] Search feature delivery — `SEARCH_FEATURE_DELIVERY.md`
- [x] Implementation summary — `IMPLEMENTATION_SUMMARY.md`
- [x] Open source issues — `OPEN_SOURCE_ISSUES.md`
- [x] Documentation index — `INDEX.md`

### Quality Tooling

- [x] Lighthouse CI config — `frontend/lighthouserc.json`
- [x] Storybook config — `frontend/.storybook/`
- [x] Prettier config — `.prettierrc`
- [x] Gitleaks config — `.gitleaks.toml`
- [x] Husky git hooks — `.husky/`
- [x] VS Code settings — `.vscode/`

---

## In Progress

| Item | Status | Notes |
|------|--------|-------|
| Backend integration test suite | Empty file exists | `backend/tests/integration.test.ts` is 0 lines; utils are ready |
| Contributor summary frontend wiring | Backend done, frontend pending | API client + component hookup in `frontend/src/services/api.ts` and `ContributorSummary.tsx` |

---

## Planned

| Item | Effort | Description |
|------|--------|-------------|
| Backend integration test suite | 3-5 days | Fill `backend/tests/integration.test.ts` with campaign lifecycle, edge case, and auth tests using existing `utils.ts` |
| Contributor summary frontend wiring | 0.5 day | Add `listCampaignContributors()` to API client, connect `ContributorSummary` component |
| Load test script backend package.json | 0.5 day | Add `load:test` and `mutation` scripts to `backend/package.json` |
| Additional E2E test coverage | 2-3 days | Expand Playwright specs beyond campaign lifecycle (pledge flow, refund flow, search) |
| API rate limiting tests | 1 day | Add tests for rate limiter middleware under load |
| Frontend visual regression coverage | 1-2 days | Add visual regression specs for key components beyond CampaignCard |
| Contract property-based testing expansion | 2-3 days | Expand proptest coverage for edge cases in campaign state transitions |
| Accessibility audit remediation | 1-2 days | Address any a11y issues surfaced by existing vitest-axe tests |
