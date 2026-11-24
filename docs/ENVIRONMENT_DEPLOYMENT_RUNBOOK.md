# Environment and deployment configuration runbook

The backend validates Soroban settings before it starts accepting requests.
This prevents a missing or contradictory network configuration from reaching a
signed transaction. Deployment uses the same explicit network/passphrase
relationship before it builds or submits a contract deployment.

## Required Soroban settings

Production must define all three variables:

```dotenv
CONTRACT_ID=CA...
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org:443
SOROBAN_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

In development and tests, leaving both `SOROBAN_RPC_URL` and
`SOROBAN_NETWORK_PASSPHRASE` unset selects the testnet defaults. If one is
provided, provide the other as well. A partial pair is rejected at startup so
the application cannot appear configured while wallet readiness is false.

The RPC endpoint and passphrase must describe the same network. The validator
recognizes the official Soroban testnet and mainnet endpoints and rejects a
crossed pair. Custom RPC endpoints may use a custom passphrase, but the
operator must still verify that they point to the intended network.

## Inspect and resolve startup failures

Start the backend and inspect the first `[startup] Environment validation
failed` message. It lists the variable and corrective action; validation runs
before the server is ready and before any wallet signing or transaction
submission.

Typical signals:

- `CONTRACT_ID is required in production`: set the deployed contract ID.
- `SOROBAN_RPC_URL and SOROBAN_NETWORK_PASSPHRASE must be configured together`:
  set both values or remove both in development/test.
- `SOROBAN_NETWORK_PASSPHRASE conflicts with ... RPC URL`: use the matching
  passphrase or change the endpoint.
- `SOROBAN_RPC_URL must use HTTPS in production`: replace an HTTP endpoint.
- A healthy process with no contract wallet operations means no signed
  transaction was attempted; fix configuration before retrying.

After changing environment variables, restart the backend and verify the
health endpoint. Do not diagnose this class of failure by connecting a wallet
or funding an account.

## Deployment script checks

`scripts/deploy.sh` defaults to testnet and does not use a wallet transaction
from the application. It requires `SECRET_KEY`, validates `NETWORK` as
`testnet` or `mainnet`, and rejects a passphrase that conflicts with that
network before building the contract.

Testnet deployment:

```bash
NETWORK=testnet \
NETWORK_PASSPHRASE='Test SDF Network ; September 2015' \
RPC_URL=https://soroban-testnet.stellar.org:443 \
SECRET_KEY='S...' \
./scripts/deploy.sh
```

For mainnet, set `NETWORK=mainnet`, the public network passphrase, a matching
RPC URL, and follow the project's deployment approval policy. Never put a
secret key in committed files or test fixtures.

## Safe verification

The validator tests and deployment guard can be exercised without live funds:

```bash
npm --prefix backend test -- --run src/validateEnv.test.ts
bash -n scripts/deploy.sh
```

These checks only parse environment values and shell syntax. They do not build,
sign, submit, or fund a Stellar transaction.
