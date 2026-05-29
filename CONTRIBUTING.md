# Contributing to Stellar Goal Vault

We love contributions! This document covers how to set up your local development environment and contribute effectively.

## Getting Started

### Prerequisites

- **Node.js** 18 or later (recommended: use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm))
- **npm** 9+
- **Rust** (if working on Soroban contracts) — install via [rustup](https://rustup.rs/)
- `wasm32-unknown-unknown` target for contract compilation:

```bash
rustup target add wasm32-unknown-unknown
```

### Fork & Clone

1. Fork the repo on GitHub
2. Clone your fork:

```bash
git clone https://github.com/your-username/stellar-goal-vault.git
cd stellar-goal-vault
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/ritik4ever/stellar-goal-vault.git
```

---

## Backend Setup

The backend is an Express REST API with SQLite persistence.

### Step-by-step

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

4. Edit `.env` if needed. At minimum, you must set `CONTRACT_ID` if you plan to interact with a deployed Soroban contract. For local development and testing, the defaults work well.

5. Start the development server with hot-reload:

```bash
npx ts-node-dev --respawn src/index.ts
```

The server starts on `http://localhost:3001` by default.

### Running Tests

The project uses [Vitest](https://vitest.dev/) for testing.

- **Run all tests:**

```bash
npm test
```

- **Run tests in watch mode** (useful during development):

```bash
npx vitest --watch
```

- **Run a single test file:**

```bash
npx vitest run src/services/campaignStore.test.ts
```

- **Run tests with coverage:**

```bash
npx vitest run --coverage
```

### Seeding the Database

For development and manual testing, deterministic campaign data can be seeded:

```bash
# Run the seed script directly
npx ts-node src/services/seedDeterministic.ts
```

The seed creates three campaigns:
- An **open** campaign (pledges still accepted)
- A **funded** campaign (target reached, ready to claim)
- A **claimed** campaign (already claimed by the creator)

### Environment Variables

See `.env.example` for all variables. Key ones:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | HTTP server port |
| `CONTRACT_ID` | Yes | — | Soroban contract ID (required at runtime) |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `DB_PATH` | No | `backend/data/campaigns.db` | SQLite database file |
| `ALLOWED_ASSETS` | No | `USDC,XLM` | Comma-separated accepted assets |
| `SOROBAN_RPC_URL` | No | `https://soroban-testnet.stellar.org:443` | Soroban RPC endpoint |
| `SOROBAN_NETWORK_PASSPHRASE` | No | Test SDF Network | Stellar network passphrase |

### Code Quality

```bash
# Lint your code
npm run lint

# Type-check (no emit)
npx tsc --noEmit
```

### Project Structure

```
backend/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── config.ts              # Environment config loader
│   ├── validateEnv.ts         # Env validation with zod
│   ├── logger.ts              # Logging utilities
│   ├── middleware/
│   │   └── requestLogging.ts  # HTTP request logging
│   ├── services/
│   │   ├── campaignStore.ts   # Campaign CRUD operations
│   │   ├── campaignStore.test.ts
│   │   ├── db.ts              # SQLite database setup
│   │   ├── eventHistory.ts    # Event log persistence
│   │   ├── eventIndexer.ts    # On-chain event indexer
│   │   ├── sorobanRpc.ts      # Stellar RPC client
│   │   └── seedDeterministic.ts
│   ├── validation/
│   │   └── schemas.ts         # Zod validation schemas
│   └── types/                 # TypeScript type definitions
├── tests/                     # Integration tests
└── scripts/                   # Utility scripts
```

### Troubleshooting

**SQLite error: `SQLITE_ERROR: no such table`**

Run the tests once to auto-create tables, or start the dev server:

```bash
npm test
```

**Port already in use**

Change the `PORT` in `.env` or kill the existing process:

```bash
lsof -ti:3001 | xargs kill -9
```

**`ts-node-dev` not found**

Make sure you ran `npm install` inside `backend/`.

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies API calls to the backend.

## Contract Development

```bash
cd contracts
cargo test
cargo clippy -- -D warnings
cargo build --target wasm32-unknown-unknown --release
```

## Pull Request Process

1. Create a new branch from `main`
2. Make your changes with small, focused commits
3. Ensure all tests pass locally
4. Update documentation if behavior changes
5. Open a PR against `ritik4ever/stellar-goal-vault` and link the related issue

Thank you for contributing! 🚀
