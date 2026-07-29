## Summary

This PR addresses issue #647 by adding a comprehensive environment variable reference table and secret rotation guide, updating the README, and fixing a backend TypeScript compiler error.

## Changes

### Documentation
- **New [ENVIRONMENT.md](docs/ENVIRONMENT.md)**: Created a detailed environment variable reference document:
  - Separate tables for **Backend**, **Frontend**, and **Contract Deployment** configurations.
  - Covers every variable from `.env.example` in both backend and frontend, plus deployment options.
  - Fields covered: Name, Required/Optional status, Defaults, Descriptions, and Examples.
  - Warns and flags sensitive keys (secrets).
  - Includes **Secret Rotation Guides** for `SECRET_KEY`, `API_KEYS`, and `REDIS_URL`.
- **Modified [README.md](README.md)**: Replaced the basic environment variable listing with a clean quick-reference table and linked to the new [ENVIRONMENT.md](docs/ENVIRONMENT.md) guide.

### Bug Fixes & Code Quality
- **Modified [config.ts](backend/src/config.ts)**: Restored missing `contractId` and `sorobanRpcUrl` properties directly to the `config` object to fix TypeScript compilation errors.
- **Fixed [schemas.ts](backend/src/validation/schemas.ts)** & **[cache.ts](backend/src/services/cache.ts)**: Fixed pre-existing syntax errors (malformed zod schemas, duplicate imports, and missing catch blocks) in the base branch to enable successful code checking.

## Acceptance Criteria Verified

- Every variable in `.env.example` is documented.
- Secrets are flagged with warnings.
- Rotation guide is provided for each secret.
- TypeScript build succeeds for configuration structures.