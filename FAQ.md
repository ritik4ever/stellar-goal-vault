# Frequently Asked Questions

## General

### 1. How do I get testnet XLM for development?

You can get free testnet XLM from the Stellar Friendbot. Visit the [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=testnet) or use the following command:

```bash
curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
```

Replace `YOUR_PUBLIC_KEY` with your testnet public key (G... address).

### 2. How do I set up Freighter wallet for local development?

1. Install the [Freighter browser extension](https://freighter.app/)
2. Open Freighter and create a new wallet or import an existing one
3. Switch to Testnet in Freighter settings
4. Fund your account with testnet XLM using Friendbot (see above)

### 3. How do I deploy the Soroban contract to testnet?

```bash
cd contracts
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_goal_vault.wasm \
  --source YOUR_SECRET_KEY \
  --network testnet
```

Make sure you have the Stellar CLI installed and your contract is compiled first:
```bash
cd contracts && cargo build --target wasm32-unknown-unknown --release
```

### 4. How do I reset the local SQLite database?

```bash
# Delete the database file and restart the backend
rm backend/data/database.sqlite
cd backend && npm run dev
```

The database will be recreated automatically with the correct schema on next startup.

### 5. How do I run tests?

```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# Contract tests (Rust)
cd contracts && cargo test

# End-to-end tests
npm run test:e2e
```

## Development

### 6. Why does my pledge fail?

Common reasons:
- Your wallet is not connected to Freighter
- You're on the wrong network (should be testnet)
- The campaign deadline has already passed
- The campaign has already reached its target amount
- You don't have enough XLM for the transaction fee

Check the browser console and backend logs for detailed error messages.

### 7. How do I add a new API endpoint?

1. Define the route in `backend/src/routes/`
2. Add validation schemas in `backend/src/validation/`
3. Implement the business logic in `backend/src/services/`
4. Write unit tests in `backend/tests/`
5. Update the API documentation

### 8. How do I run the project locally with Docker?

```bash
docker compose up --build
```

This starts the backend (port 3001), frontend (port 5173), and any required services. The frontend will be available at `http://localhost:5173` and the API at `http://localhost:3001`.

### 9. How do I run load tests?

```bash
cd backend
node test-requests.js
```

This runs a series of simulated requests against the local API. Review the output for performance metrics and error rates.

### 10. Where can I find architecture documentation?

- [ARCHITECTURE_DIAGRAMS.md](./ARCHITECTURE_DIAGRAMS.md) - System architecture overview
- [ADR directory](./adr/) - Architecture Decision Records
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment instructions
- [CONTRIBUTING.md](./CONTRIBUTING.md) - How to contribute

## Troubleshooting

### 11. The build fails with a TypeScript error

Make sure you have the correct Node.js version (18+) and run `npm ci` in the relevant directory before building:

```bash
cd backend && npm ci && npm run build
cd frontend && npm ci && npm run build
```

### 12. Docker containers exit immediately

Check the logs with `docker compose logs`. Common issues:
- Port 3001 or 5173 is already in use
- Missing environment variables in `docker-compose.override.yml`
- Docker daemon is out of disk space
