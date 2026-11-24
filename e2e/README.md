# Playwright E2E fixtures

Wallet, campaign, and pledge fixtures under `e2e/fixtures/` keep browser tests
**repeatable without live funds**. They never call Friendbot, never open a real
Freighter extension, and never submit to public Stellar networks.

## Wallet-flow safety

Use the fixture-only runner while diagnosing wallet behavior:

```bash
npm run test:e2e:fixtures
```

This uses `playwright.fixtures.config.ts`, which matches only
`wallet-fixtures-reliability.spec.ts` and starts no backend or frontend server.
The tests use synthetic keys from `TEST_CONTRIBUTORS` and an in-memory XDR;
there is no funded account, transaction submission, or live wallet involved.

## Wallet mock (`mockFreighter`)

`mockFreighter(page, publicKey, options?)` installs an in-page Freighter
emulator that answers the `@stellar/freighter-api` v2 `postMessage` bridge.

| `sign` option | Behaviour | Observable status |
| --- | --- | --- |
| `approve` (default) | Echoes the unsigned XDR as “signed” | `idle` |
| `reject` | Immediate stop with a declined-signature error | `stopped` |
| `delay` | Parks the request until recovery | `awaiting_signature` |

### Inspecting a failure

After the request is made, inspect the mock from the same Playwright page:

```ts
const snapshot = await readWalletMockSnapshot(page);
console.log(snapshot.status, snapshot.sign, snapshot.pendingCount);
console.log(await readBridgeLog(page));
```

Use the signals below to distinguish a user-style rejection from a hung
signature prompt:

- `status: 'stopped'`, `pendingCount: 0`, and a `SUBMIT_TRANSACTION` log entry
  with `outcome: 'rejected'` mean the mock rejected the signature.
- `status: 'awaiting_signature'` with `pendingCount > 0` means the request is
  deliberately parked; it is not a network timeout.
- A resolved approval adds `outcome: 'approved'` and returns the original XDR.
- A reset adds `outcome: 'cancelled'` and returns the
  `Wallet mock reset: cancelled delayed signature.` error to the parked call.

The bridge log is in-memory and is intended for assertions and failure
diagnosis; it does not contain private keys or send anything to Stellar.

### Resolving reject and delay failures

1. **Reject** — verify `status === 'stopped'`, capture the returned `error`,
   then reset and retry:

   ```ts
   await recoverWalletMock(page, 'approve');
   ```

2. **Delay** — verify `status === 'awaiting_signature'` and
   `pendingCount > 0`, then choose one deterministic recovery:

   - `resolveDelayedSignatures(page, 'approve' | 'reject')` — finish parked requests
   - `resetWalletMock(page)` — cancel parked requests, restore `approve` + `grant`
   - `recoverWalletMock(page)` — reset, then optionally set the next sign mode
   - `setWalletMockSignBehavior(page, mode)` — change mode for the next attempt

`resolveDelayedSignatures(page, 'approve')` completes the pending call and
returns the original XDR. Use `'reject'` when the test needs to verify the
delayed failure path; the final status is then `stopped`. Use
`resetWalletMock(page)` when the pending call should be cancelled instead.

Calling `mockFreighter` again on the same page also cancels any delayed
signatures before applying the new options, so Playwright retries stay safe.
Do not wait for a real wallet popup or add a retry delay to recover a fixture:
inspect `pendingCount` and resolve or reset the mock explicitly.

### Focused coverage

`wallet-fixtures-reliability.spec.ts` asserts approve, reject → recover,
delay → approve, delay → reject, delay → reset, and reinstall-on-retry
behaviour. A failure in this file is local to the fixture bridge; it does not
indicate a failed on-chain transaction.

## Campaign / pledge fixtures

`CampaignBuilder` and `PledgeBuilder` create isolated API state per test
(`scope-*` titles). They use synthetic `TEST_CREATORS` / `TEST_CONTRIBUTORS`
keys and never require funded accounts.

## Running

```bash
# Fixture reliability only (no app servers / no live funds):
npx playwright test --config=playwright.fixtures.config.ts

# Full E2E suite (starts backend + frontend via playwright.config.ts):
npm run test:e2e
```
