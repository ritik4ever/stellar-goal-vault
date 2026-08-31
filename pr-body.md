Closes #636

## Summary

This PR addresses issue #636 by increasing the backend test coverage to **81.41% branch coverage** and **81.90% statement/line coverage**. It fixes pre-existing runtime bugs and test failures, refactors the `addPledge` service to be synchronous, enforces strict CRC validation on Stellar public keys, and introduces a robust suite of new unit tests covering Express middlewares, route handlers, and refund/token balance logic.

## Changes

### Bug Fixes & Code Quality
- **Refactored [campaignStore.ts](backend/src/services/campaignStore.ts)**: Made `addPledge` synchronous since its underlying SQLite database operations are synchronous. This resolves the Promise-spreading bug in [index.ts](backend/src/index.ts) that was stripping properties like `id` and `deadline` from active campaign responses.
- **Fixed test keys and schemas in [schemas.ts](backend/src/validation/schemas.ts) & [stellarAddress.test.ts](backend/src/validation/stellarAddress.test.ts)**:
  - Fixed a typo in the tests' main valid public key (`GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNV` -> ending in `7`).
  - Added `.refine(isValidStellarPublicKey)` checksum validation to Zod's `stellarAccountIdSchema`.
  - Updated all dummy/placeholder test keys to valid checksum-passing keys across the test suite to pass the refined Zod validation.
- **Fixed concurrent test states in [campaignStore.concurrent.test.ts](backend/src/services/campaignStore.concurrent.test.ts)**:
  - Corrected setup sequence by making pledges while campaign is open, then manually expiring the campaign in the database via SQL.
  - Wrapped synchronous calls in promise helper chains to simulate proper concurrent execution and corrected signature arguments for `claimCampaign`.
- **Fixed Windows database locks in [historyEndpoint.test.ts](backend/src/historyEndpoint.test.ts)**: Included database resets (`resetDbForTests()`) in `afterAll` hooks to release active SQLite file locks, allowing clean test file deletion on Windows.
- **Removed empty [integration.test.ts](backend/tests/integration.test.ts)** to prevent empty test suite collection errors.

### New Unit Tests
- **[middleware.test.ts](backend/src/tests/middleware.test.ts)**: Added tests covering API key authorization checks, public route bypasses, cache misses/hits, cache invalidation, and mock Redis caching service states.
- **[refundLogic.test.ts](backend/src/tests/refundLogic.test.ts)**: Added tests covering contributor refund status constraints, database state updates, event recording, and group/multi-asset campaign token balance calculations.
- **[routeHandlers.test.ts](backend/src/tests/routeHandlers.test.ts)**: Added tests covering configuration loading, open issues retrieval, leaderboard query limits, global statistics, payload-too-large 413 handling, and CORS-violation 403 handling.

## Verification

### Automated Tests
- TypeScript build succeeds: `npm run build`
- All tests compile and pass: `npm run test` (317 tests passed)
- Scoped branch coverage of **81.41%** (target >= 80% met): `npm run test -- --coverage`