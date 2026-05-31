# Changelog

All notable changes to Stellar Goal Vault will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Campaign creation with Stellar smart contract integration
- Pledge management with Soroban contract escrow
- Campaign detail panel with deep-link routing
- Creator analytics dashboard
- Virtual scrolling for campaign lists
- Lazy loading for campaign images with CDN support
- Service worker for offline-first campaign list caching
- In-memory caching layer for API responses
- SSRF protection for user-supplied URLs in campaign metadata
- Server-side pagination for large campaign lists
- SQLite index on campaigns.deadline for deadline-based queries
- Contract property tests for claim/refund mutual exclusivity
- React.lazy with Suspense for lazy component loading
- Error boundary wrapping async data-fetching components
- Storybook setup for shared UI components
- Campaign permalink route using React Router
- Mutation testing documentation with Stryker
- Docker multi-stage build for smaller images
- Request ID header for request tracing
- Backend integration tests for full pledge-reconcile flow
- Frontend CI workflow with Vitest and lint
- Backend CI workflow with Jest and ESLint
- Accessibility tests with axe-core
- Backend snapshot tests for API response shapes

### Security
- Content-Security-Policy headers for frontend build
- express-validator sanitization for HTML content in API responses
- Request body size limits to prevent payload flooding
- CORS configuration for specific allowed origins
- OWASP top-10 security review checklist in PR process
- Stellar account address sanitization

### Changed
- Migrated campaign store queries to use indexed SQLite
- Optimized campaign list with single-pass render
- Improved pledge status display with real-time updates
