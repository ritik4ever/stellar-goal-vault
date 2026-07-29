# Contributing

Thank you for your interest in contributing to **Stellar Goal Vault**! We welcome all contributions, from bug fixes and documentation to new features. This guide will help you go from zero to passing tests and submitting your first Pull Request.

## Finding a Good First Issue

If you're looking for a place to start:
1. Browse `OPEN_SOURCE_ISSUES.md` for curated contribution ideas.
2. Check our GitHub Issues tab for issues labeled `good first issue` or `help wanted`.
3. Read the [README.md](./README.md) to understand the project overview and architecture.
4. Check the [FAQ.md](./FAQ.md) for answers to common questions.

## Local Setup Checklist

Follow these steps to set up the project locally:

1. **Fork and Clone**
   - Fork the repository on GitHub.
   - Clone your fork: `git clone https://github.com/YOUR_USERNAME/stellar-goal-vault.git`
   - Navigate to the directory: `cd stellar-goal-vault`

2. **Install Dependencies**
   - **Node.js** 18+ and **npm** 9+ are required.
   - Run `npm run install:all` in the root directory to install both frontend and backend dependencies.

3. **Backend Setup**
   - Navigate to the backend directory: `cd backend`
   - Copy the environment file: `cp .env.example .env`
   - Configure `.env` (default values are fine for local development).
   - Go back to root: `cd ..`

4. **Create a Branch**
   - `git checkout -b feature/my-feature`

## Running All Tests

To ensure everything is working correctly, run the test suites:

- **Backend Tests**: 
  ```bash
  cd backend
  npm test
  ```
- **Frontend Tests**:
  ```bash
  cd frontend
  npm test
  ```
- **Contract Tests**: 
  ```bash
  cd contracts
  cargo test
  ```
- **E2E Tests**: 
  ```bash
  npm run test:e2e
  ```

If all tests pass, your local environment is correctly configured!

## Local Soroban Testnet Setup

To interact with the smart contracts on the testnet:

1. **Install Soroban CLI**:
   ```bash
   cargo install --locked soroban-cli
   ```
2. **Configure Testnet Network**:
   ```bash
   soroban network add \
     --global testnet \
     --rpc-url https://soroban-testnet.stellar.org:443 \
     --network-passphrase "Test SDF Network ; September 2015"
   ```
3. **Generate an Identity**:
   ```bash
   soroban keys generate --global alice --network testnet
   ```
4. **Fund your Account**:
   - The CLI automatically funds new identities via Friendbot. You can verify your balance with:
   ```bash
   soroban keys address alice
   ```
5. **Update `.env`**:
   - Set `CONTRACT_ID` in `backend/.env` to a deployed testnet contract or deploy your own (see `README.md`).

## Opening a Pull Request

1. Make your changes and ensure all tests pass (`npm test`).
2. **Commit** your changes using conventional commits (e.g., `feat: add new endpoint`, `fix: correct typo in docs`).
3. **Push** your branch: `git push origin feature/my-feature`.
4. Open a **Pull Request** against the `main` branch.
5. Provide a clear description of the problem you are solving and the changes you made.

## Code Style

- **TypeScript**: ESLint + Prettier (pre-commit via Husky + lint-staged)
- **Rust**: `cargo fmt`

## Common Setup Errors and Fixes

Here are the top 5 most common issues new contributors run into:

#### 1. "SQLITE_CANTOPEN" or database file not found
- **Fix**: Ensure the directory specified in `DB_PATH` exists. If you are in the `backend` directory, run `mkdir -p data`.

#### 2. Tests fail with "database is locked"
- **Fix**: This indicates concurrent access issues. Ensure only one test process is running. Try clearing the test database: `rm test-temp-*.db*` or run tests serially with `npm test -- --no-coverage`.

#### 3. "Cannot find module" errors
- **Fix**: You might have skipped dependency installation. Run `npm run install:all` in the project root, or `npm install` inside the respective `backend`/`frontend` directory.

#### 4. Port already in use (EADDRINUSE)
- **Fix**: If port 3000 or 3001 is taken, change the `PORT` variable in your `.env` file (e.g., to 3002) or kill the existing process using that port.

#### 5. Soroban CLI build/deploy errors
- **Fix**: Ensure you have the `wasm32-unknown-unknown` Rust target installed: `rustup target add wasm32-unknown-unknown`. Also, make sure your Soroban CLI version matches the network version requirements.

## Questions?

Check the [FAQ.md](./FAQ.md) before opening an issue. If your question isn't covered there, feel free to open a GitHub Discussion.