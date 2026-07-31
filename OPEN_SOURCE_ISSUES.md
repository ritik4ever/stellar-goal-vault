# Open Source Issues To Publish

This document outlines 20+ contribution opportunities for the Stellar Goal Vault repository.

## 1. Implement Freighter-signed pledge transactions
**Difficulty:** Advanced
**Estimated Effort:** 2 weeks
**Files to Modify:** `frontend/src/components/PledgeButton.tsx`, `frontend/src/services/stellar.ts`
**Tags:** enhancement, soroban

## 2. Sync campaign activity from Soroban RPC events
**Difficulty:** Intermediate
**Estimated Effort:** 1 week
**Files to Modify:** `backend/src/workers/indexer.ts`, `backend/src/db/schema.sql`
**Tags:** backend, indexer

## 3. Add filters and sort presets to the dashboard
**Difficulty:** Beginner
**Estimated Effort:** 2 days
**Files to Modify:** `frontend/src/pages/Dashboard.tsx`, `frontend/src/components/FilterBar.tsx`
**Tags:** frontend, ux, good first issue

## 4. Update README with local setup instructions
**Difficulty:** Beginner
**Estimated Effort:** 1 day
**Files to Modify:** `README.md`
**Tags:** docs, good first issue

## 5. Implement comprehensive unit tests for Campaign creation
**Difficulty:** Intermediate
**Estimated Effort:** 3 days
**Files to Modify:** `backend/tests/unit/campaign.test.ts`
**Tags:** backend, testing

## 6. Fix mobile layout overflow on Campaign Details page
**Difficulty:** Beginner
**Estimated Effort:** 1 day
**Files to Modify:** `frontend/src/styles/campaignDetails.css`
**Tags:** frontend, css, good first issue

## 7. Refactor Error Handling in API Gateway
**Difficulty:** Intermediate
**Estimated Effort:** 1 week
**Files to Modify:** `backend/src/api/gateway.ts`, `backend/src/utils/errors.ts`
**Tags:** backend, refactor

## 8. Add GitHub Actions CI for running E2E Playwright tests
**Difficulty:** Advanced
**Estimated Effort:** 1.5 weeks
**Files to Modify:** `.github/workflows/e2e.yml`, `playwright.config.ts`
**Tags:** ci, testing

## 9. Create a Dark Mode toggle in the Frontend
**Difficulty:** Intermediate
**Estimated Effort:** 3 days
**Files to Modify:** `frontend/src/App.tsx`, `frontend/tailwind.config.js`
**Tags:** frontend, ux

## 10. Add ESLint and Prettier pre-commit hooks using Husky
**Difficulty:** Beginner
**Estimated Effort:** 1 day
**Files to Modify:** `package.json`, `.husky/pre-commit`
**Tags:** tooling, good first issue

## 11. Implement Campaign Claim logic for successful campaigns
**Difficulty:** Advanced
**Estimated Effort:** 2 weeks
**Files to Modify:** `contracts/src/campaign.rs`, `contracts/src/lib.rs`
**Tags:** soroban, rust

## 12. Create API endpoint for fetching campaign analytics
**Difficulty:** Intermediate
**Estimated Effort:** 1 week
**Files to Modify:** `backend/src/controllers/analytics.ts`, `backend/src/routes.ts`
**Tags:** backend, api

## 13. Localize Frontend strings to Spanish
**Difficulty:** Beginner
**Estimated Effort:** 2 days
**Files to Modify:** `frontend/src/i18n/es.json`
**Tags:** frontend, i18n, good first issue

## 14. Migrate SQLite to PostgreSQL for production readiness
**Difficulty:** Advanced
**Estimated Effort:** 3 weeks
**Files to Modify:** `backend/src/db/connection.ts`, `docker-compose.yml`
**Tags:** backend, database

## 15. Standardize button components across the application
**Difficulty:** Intermediate
**Estimated Effort:** 3 days
**Files to Modify:** `frontend/src/components/common/Button.tsx`, `frontend/src/pages/*.tsx`
**Tags:** frontend, design-system

## 16. Add rate limiting middleware to public API routes
**Difficulty:** Intermediate
**Estimated Effort:** 2 days
**Files to Modify:** `backend/src/middleware/rateLimiter.ts`
**Tags:** backend, security

## 17. Design and implement a 404 Not Found page
**Difficulty:** Beginner
**Estimated Effort:** 1 day
**Files to Modify:** `frontend/src/pages/NotFound.tsx`, `frontend/src/App.tsx`
**Tags:** frontend, ux

## 18. Write architecture documentation for Indexer service
**Difficulty:** Intermediate
**Estimated Effort:** 1 week
**Files to Modify:** `docs/INDEXER_ARCHITECTURE.md`
**Tags:** docs, architecture

## 19. Optimize Docker image sizes by utilizing multi-stage builds
**Difficulty:** Intermediate
**Estimated Effort:** 3 days
**Files to Modify:** `Dockerfile`, `backend/Dockerfile`
**Tags:** devops, docker

## 20. Implement JWT refresh token rotation
**Difficulty:** Advanced
**Estimated Effort:** 2 weeks
**Files to Modify:** `backend/src/controllers/auth.ts`, `backend/src/middleware/auth.ts`
**Tags:** backend, security

## 21. Add user avatar upload feature
**Difficulty:** Intermediate
**Estimated Effort:** 1 week
**Files to Modify:** `frontend/src/components/Profile.tsx`, `backend/src/controllers/user.ts`
**Tags:** fullstack, feature
