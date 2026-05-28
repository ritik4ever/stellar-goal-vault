# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Campaign creation and management with Soroban smart contract integration
- Pledge/contribution system with milestone tracking
- Freighter wallet integration for Stellar transaction signing
- Campaign search with filters (status, category, deadline)
- Responsive frontend built with React + TypeScript + Vite
- Backend API with Express + SQLite for campaign data
- Real-time campaign status updates via WebSocket
- Docker Compose setup for local development
- Test suite with Vitest for backend and frontend
- Playwright e2e tests for critical user flows
- Property-based tests for Soroban contract claim/refund logic
- CI pipeline with GitHub Actions for lint, type-check, and tests
- Contribution guide and issue/PR templates

### Changed
- Migrated campaign store queries to use single SQL join for performance
- Updated contract deployment scripts for testnet compatibility

### Fixed
- Campaign deadline validation edge cases
- WebSocket reconnection handling on network interruption

### Security
- Input validation with Zod schemas for API endpoints
- Dependency auditing with npm audit and cargo audit
- CodeQL security analysis workflow integrated
- Dependabot configuration for automated dependency updates

## [0.1.0] - 2026-03-20

### Added
- Initial project scaffold with frontend, backend, and contracts structure
- Basic Soroban contract for campaign creation and pledging
- Express API with CRUD endpoints for campaigns
- React frontend with campaign listing and detail views
- SQLite database with migrations for campaign storage
- Docker configuration for development environment
- Basic CI workflow for build verification

[unreleased]: https://github.com/ritik4ever/stellar-goal-vault/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ritik4ever/stellar-goal-vault/releases/tag/v0.1.0
