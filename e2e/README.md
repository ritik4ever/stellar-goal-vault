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
delay → resolve, delay → reset, and reinstall-on-retry behaviour.

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
