# Playwright E2E fixtures

Wallet, campaign, and pledge fixtures under `e2e/fixtures/` keep browser tests
**repeatable without live funds**. They never call Friendbot, never open a real
Freighter extension, and never submit to public Stellar networks.

## Wallet mock (`mockFreighter`)

`mockFreighter(page, publicKey, options?)` installs an in-page Freighter
emulator that answers the `@stellar/freighter-api` v2 `postMessage` bridge.

| `sign` option | Behaviour | Observable status |
| --- | --- | --- |
| `approve` (default) | Echoes the unsigned XDR as “signed” | `idle` |
| `reject` | Immediate stop with a declined-signature error | `stopped` |
| `delay` | Parks the request until recovery | `awaiting_signature` |

### Stop and recovery path

1. **Reject** — signing stops; `readWalletMockSnapshot(page).status === 'stopped'`.
2. **Delay** — status becomes `awaiting_signature` and `pendingCount > 0`.
3. **Recover** without a reload:
   - `resolveDelayedSignatures(page, 'approve' | 'reject')` — finish parked requests
   - `resetWalletMock(page)` — cancel parked requests, restore `approve` + `grant`
   - `recoverWalletMock(page)` — reset, then optionally set the next sign mode
   - `setWalletMockSignBehavior(page, mode)` — change mode for the next attempt

Calling `mockFreighter` again on the same page also cancels any delayed
signatures before applying the new options, so Playwright retries stay safe.

### Focused coverage

`wallet-fixtures-reliability.spec.ts` asserts approve, reject → recover,
delay → resolve, delay → reset, reinstall-on-retry, and signed-but-unconfirmed
testnet pledge behaviour.

## Signed-but-unconfirmed testnet pledge

When a contributor signs a testnet pledge in Freighter and the transaction is
submitted to Soroban RPC (`sendTransaction` returns `PENDING` with a hash) but
ledger confirmation has not yet arrived (`getTransaction` returns `NOT_FOUND` or
`PENDING`):

- **Wallet mock state**: `mockFreighter` records `SUBMIT_TRANSACTION` with
  `outcome: 'approved'`, echoes the XDR as `signedTransaction`, and returns
  `status === 'idle'`. The mock cannot establish ledger confirmation on its own.
- **UI & RPC polling (`frontend/src/services/freighter.ts`)**: `submitFreighterPledge`
  keeps the per-campaign/contributor `inFlightSubmissions` lock held while
  `waitForTransaction` polls `getTransaction` (up to 25 attempts, 1200 ms apart).
  Duplicate concurrent pledge attempts fail immediately with `TRANSACTION_IN_FLIGHT`.
- **Backend / committed campaign data**: `reconcilePledge`
  (`POST /api/campaigns/:id/pledges/reconcile`) is **not** called until
  `getTransaction` returns `SUCCESS`, so `pledges` and `campaigns.pledgedAmount`
  remain unchanged while the transaction is unconfirmed.
- **Timeout**: If confirmation still has not arrived after 25 poll attempts,
  `waitForTransaction` throws `TRANSACTION_TIMEOUT`, releases the in-flight lock,
  and leaves committed campaign data untouched.

To assert this state in E2E without live funds or public testnet calls, pair
`mockFreighter` with `page.route()` on a loopback `sorobanRpcUrl` that returns
`PENDING` for `sendTransaction` and `NOT_FOUND` for `getTransaction`.

## Campaign / pledge fixtures

`CampaignBuilder` and `PledgeBuilder` create isolated API state per test
(`scope-*` titles). They use synthetic `TEST_CREATORS` / `TEST_CONTRIBUTORS`
keys and never require funded accounts.

## Running

The full runner validates setup **before starting either server**. It reads
`backend/.env` using dotenv syntax, with exported environment variables taking
precedence. An unreadable file or unsafe configuration stops the run with an
`E2E setup:` error (values are not echoed).

- `DB_PATH` must be unset or `:memory:`. E2E always uses a fresh in-memory
  database, never an existing development database file. Remove a file path from
  the test environment or run with `DB_PATH=:memory:`.
- `NODE_ENV` must be unset, `development`, or `test`; the backend runs as `test`.
- `PORT` must be unset or `3001`, matching the frontend proxy.
- `VITE_API_URL` must be unset or `/api`, so browser writes use that proxy.
  The frontend's `.env`, `.env.local`, `.env.development` and
  `.env.development.local` files are also checked in Vite priority order;
  exported `VITE_API_URL` takes precedence. Both servers receive the validated
  environment explicitly.
- `SOROBAN_NETWORK_PASSPHRASE` must be unset or exactly
  `Test SDF Network ; September 2015`.
- `SOROBAN_RPC_URL` defaults to the Stellar testnet endpoint. If supplied, it
  must be an absolute HTTP(S) loopback URL or HTTPS on
  `soroban-testnet.stellar.org`, without credentials or fragments.

Neither server is reused: stop any service on ports 3000/3001 before running.
This prevents fixture API writes from reaching an unrelated running backend.
The fixture-only runner needs neither `.env` nor app servers.
The visual runner selects only `*.visual.spec.ts`, so it cannot accidentally
discover wallet/campaign specs that write backend state.

Wallet options are also checked before any bridge script is installed or an
existing delayed signature is cancelled. Keys must have synthetic G-address
shape (not funded account validation), modes must match the documented enums,
and optional RPC metadata must be a credential-free absolute HTTP(S) URL.
An explicitly reported public-network passphrase remains available for negative
network-mismatch tests; it is only mock metadata and does not sign or submit a
real transaction. The mock echoes XDR and cannot establish ledger confirmation.
`wallet-fixtures-setup.spec.ts` covers invalid environment, file and wallet inputs.

## Clean-checkout setup & running

From a clean checkout (without live funds):

```bash
# 1. Install root Playwright tooling and Chromium
npm ci --legacy-peer-deps
npx playwright install chromium

# 2. Fixture reliability + setup validation (no app servers / no live funds)
npm run test:e2e:fixtures

# 3. Full E2E suite (requires backend + frontend dependencies installed)
cd backend && npm ci --legacy-peer-deps && cd ../frontend && npm ci && cd ..
npm run test:e2e
```
