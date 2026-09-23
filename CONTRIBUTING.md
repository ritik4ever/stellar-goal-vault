# Contributing

Thank you for your interest in contributing to **Stellar Goal Vault**!

## Quick start

1. **Fork** the repository on GitHub.
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/stellar-goal-vault.git`
3. **Install dependencies:** `npm run install:all`
4. **Create a branch:** `git checkout -b feature/my-feature`
5. Make your changes and test them.
6. **Commit** using conventional commits (e.g., `feat: add new endpoint`).
7. **Push** and open a **Pull Request** against the `main` branch.

## Before you start

- Read the [README.md](./README.md) for project overview and architecture.
- Check the [FAQ.md](./FAQ.md) for answers to common questions.
- See the [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) for solutions to common development issues.
- Browse `OPEN_SOURCE_ISSUES.md` for curated contribution ideas.
- To test the pledge flow with a real wallet, follow the [Freighter Pledge Signing Walkthrough](./docs/FREIGHTER_GUIDE.md).

## Backend Development

### Prerequisites

- **Node.js** 18+ (check with `node --version`)
- **npm** 9+ (comes with Node.js)

### Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables in `.env`:
   - `DB_PATH`: Path to SQLite database file (default: `../../data/campaigns.db`)
   - `NODE_ENV`: Set to `development` for local development
   - `PORT`: Server port (default: 3000)
   - `CORS_ALLOWED_ORIGINS`: Comma-separated list of allowed origins
   - `CONTRACT_ID`: Stellar contract ID (required for pledge operations)
   - `SOROBAN_RPC_URL`: URL to Soroban RPC endpoint
   - `NETWORK_PASSPHRASE`: Stellar network (default: `Test SDF Network ; September 2015` for testnet)

### Running the Backend

- **Development mode** (with auto-reload):
  ```bash
  npm run dev
  ```
  Server listens on `http://localhost:3000` by default.

- **Production mode** (build and run):
  ```bash
  npm run build
  npm start
  ```

- **Watch mode** (for editing and testing):
  ```bash
  npm run dev
  ```

### Testing

- **Run all tests once**:
  ```bash
  npm test
  ```

- **Run tests in watch mode** (re-run on file changes):
  ```bash
  npm run test:watch
  ```

- **Run with coverage**:
  ```bash
  npm test -- --coverage
  ```

### Database

- **Seeding**: The application automatically initializes the SQLite database with the schema on first run. To seed deterministic test campaigns:
  ```bash
  npm test -- tests/services/seedDeterministic.test.ts
  ```

- **Viewing the database**:
  - Use SQLite CLI: `sqlite3 ../../data/campaigns.db`
  - Or use a GUI tool like [DB Browser for SQLite](https://sqlitebrowser.org/)

- **Resetting the database** (for testing):
  - Delete the database file: `rm ../../data/campaigns.db`
  - Next run will recreate it with the schema

### Troubleshooting

See the [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) for a comprehensive list of common issues.

#### "SQLITE_CANTOPEN" or database file not found
- Ensure the directory specified in `DB_PATH` exists
- Check file permissions on the database directory
- If the directory doesn't exist, create it: `mkdir -p data`

#### Tests fail with "database is locked"
- This indicates concurrent access issues. Ensure only one test process is running.
- Try clearing the test database: `rm test-temp-*.db*`
- Run tests serially: `npm test -- --no-coverage`

#### "Cannot find module" errors
- Run `npm install` in the `backend` directory
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

#### Port already in use
- Change the `PORT` in `.env` to an available port (e.g., 3001)
- Or kill the process on the current port

#### Environment variable not picked up
- Ensure `.env` file is in the `backend` directory
- Restart the development server after editing `.env`
- Check for syntax errors in `.env` (no spaces around `=`)

## Testing

- Backend: `cd backend && npm test`
- Contract: `cd contracts && cargo test`
- E2E: `npm run test:e2e`

## CI artifacts

CI uploads a small, fixed set of artifacts with bounded retention so failed runs can be diagnosed without re-running them. Artifact names end in `-<run_id>-<run_attempt>`, so re-runs and matrix jobs never collide. Only explicit paths are uploaded — never `.env` files, `node_modules`, keys or `contracts/target`.

| Artifact (name prefix) | Workflow | Uploaded | Kept |
| --- | --- | --- | --- |
| `backend-build-npm-audit` | CI - Build Checks | always | 14 days |
| `backend-build-diagnostics`, `frontend-build-diagnostics` (npm debug logs) | CI - Build Checks | on failure | 7 days |
| `contract-build-wasm` (release `.wasm`) | CI - Build Checks | on success | 7 days |
| `contract-build-diagnostics` (`cargo build` / `cargo test` logs) | CI - Build Checks | on failure | 7 days |
| `backend-tests-coverage`, `integration-tests-coverage-node-<version>`, `frontend-ci-coverage` | PR Tests, Backend Integration Tests, Frontend CI | always | 14 days |
| `contracts-ci-cargo-audit`, `load-test-results` | Contracts CI, Load Test | always | 14 days |
| `playwright-e2e-report` | Playwright E2E Tests | always | 14 days |
| `playwright-e2e-test-results` (traces, videos, screenshots), `playwright-e2e-docker-logs` | Playwright E2E Tests | on failure | 7 days |
| `visual-regression-artifacts` | Playwright Visual Regression | on failure | 7 days |

To download them, open the failed run under the repository's **Actions** tab and use the **Artifacts** section at the bottom of the run summary, or use the GitHub CLI:

```bash
gh run list --status failure --limit 5      # find the run id
gh run download <run-id>                    # all artifacts
gh run download <run-id> -n <artifact-name> # one artifact
```

Retention is set per upload with `retention-days` (7 for failure diagnostics, 14 for reports and coverage). When adding an upload step, keep those values, set `if-no-files-found: ignore`, and list explicit paths.

## Code style

- TypeScript: ESLint + Prettier (pre-commit via Husky + lint-staged)
- Rust: `cargo fmt`

## Adding new open issues

The `GET /api/open-issues` endpoint serves a statically seeded list of contribution ideas
that are displayed in the frontend **Contribution Backlog** panel.

To add a new issue:

1. Open [`backend/src/services/openIssues.ts`](./backend/src/services/openIssues.ts).
2. Append a new entry to the `seededIssues` array:
   ```ts
   {
     id: 'SGV-4',                                    // continue the SGV-N sequence
     title: 'Short, descriptive title',
     labels: ['frontend', 'good first issue'],
     summary: 'One or two sentences describing the work.',
     complexity: 'Trivial',                          // Trivial | Medium | High
     points: 100,                                    // 100 | 150 | 200
   }
   ```
3. Match `points` to `complexity`: Trivial → 100, Medium → 150, High → 200.
4. No migration or server restart is needed — the endpoint reads the array directly.

Full endpoint documentation (example response, field table, complexity/points enum):
[docs/API.md — GET /api/open-issues](./docs/API.md#get-apiopen-issues)

## Questions?

Check the [FAQ.md](./FAQ.md) before opening an issue. If your question isn't covered there, feel free to open a GitHub Discussion.