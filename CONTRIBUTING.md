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
- Browse `OPEN_SOURCE_ISSUES.md` for curated contribution ideas.

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

## Code style

- TypeScript: ESLint + Prettier (pre-commit via Husky + lint-staged)
- Rust: `cargo fmt`

## Questions?

Check the [FAQ.md](./FAQ.md) before opening an issue. If your question isn't covered there, feel free to open a GitHub Discussion.