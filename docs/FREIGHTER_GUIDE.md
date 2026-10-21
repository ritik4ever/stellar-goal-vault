# Freighter Pledge Signing Walkthrough

Category: stellar / wallet

This guide walks you through the full pledge flow in Stellar Goal Vault — from installing Freighter to signing a pledge transaction on Stellar testnet. Follow it end-to-end and you will have made a real on-chain contribution without needing a funded mainnet account.

---

## Prerequisites

- Google Chrome or Firefox
- The app running locally (`npm run dev`
 in both `backend/` and `frontend/`)
- A few minutes — the whole flow takes under 10 minutes

---

## Step 1 — Install Freighter

Freighter is the Stellar browser extension wallet. It stores your keypair locally and signs transactions without ever exposing your private key to the app.

1. Open the [Freighter download page](https://freighter.app) in your browser.
2. Click **Add to Chrome** (or Firefox) and confirm the install prompt.
3. Click the Freighter icon in your browser toolbar to open it.

> **Screenshot placeholder:** Freighter extension icon in the browser toolbar after installation.

4. Click **Create a new wallet**.
5. Set a strong password and click **Next**.
6. Write down your **12-word recovery phrase** and store it somewhere safe. You will need it to restore your wallet if you reinstall the extension.
7. Confirm the recovery phrase when prompted, then click **Done**.

Your wallet is now created.

---

## Step 2 — Switch to Testnet

The app runs against Stellar testnet by default. You must match the network in Freighter or every transaction will fail with a network mismatch error.

1. In the Freighter popup, click the gear icon (**Settings**) in the top-right corner.
2. Select **Network**.
3. Choose **Test DF Network ;; September 2015** (the testnet option).
4. Click **Save**.

The Freighter header should now show **TESTNET** in the network badge.

> **Screenshot placeholder:** Freighter network selector showing Testnet selected.

---

## Step 3 — Fund Your Testnet Wallet

Testnet XLM is free. Stellar's Friendbot will credit 10,000 XLM to any new testnet address.

1. In Freighter, copy your public key. It starts with `Gand is about 56 characters long. Click your address in the header to copy it.

2. Open the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/account/create?network=testnet) in a new tab.

3. Paste your public key into the **Public Key** field and click **Get test network lumens**.

   Alternatively, fund via the API directly:

   ```bash
   curl "https://friendbot.stellar.org?adr=YOUR_PUBLIC_KEY"
   ```

4. Return to Freighter. Your balance should update within a few seconds to show **10,000 XLM**.

> **Screenshot placeholder:** Freighter balance view showing testnet XLM balance after Friendbot funding.

> **Why do I need XLM?** Every Stellar transaction pays a small network fee in XLM (typically ~0.00001 XLM). Your account also needs a minimum reserve of 1 XLM to remain active. Testnet XLM has no real-world value.

---

## Step 4 — Create a Test Campaign

Before pledging you need an active campaign. If one already exists in your local dashboard you can skip ahead to [Step 5](#step-5--connect-freighter-to-the-app).

1. Open the app at [http://localhost:3000](http://localhost:3000).
2. Click **New Campaign** in the top-right corner of the dashboard.
3. Fill in the form:
   - **Title:** `Test Campaign`
   - **Description:** Anything you like
   - **Target Amount:** `100`
   - **Asset:** `XLM`
   - **Deadline:** Any future date at least a few minutes away
4. Click **Create Campaign**.

The campaign card appears on the dashboard with status **Open**.

> **Screenshot placeholder:** Campaign creation form with fields filled in.

---

## Step 5 — Connect Freighter to the App

1. In the app header, locate the **Connect Wallet** button (top-right area).
2. Click it. Freighter will open an approval popup asking if you want to grant the app access to your address.
3. Click **Connect** in the Freighter popup.

The header widget updates to show your shortened public key, confirming the wallet is connected.

> **Screenshot placeholder:** App header showing connected wallet public key.

> If the popup does not appear, see [Troubleshooting — Popup Blocked](#popup-blocked).

> If the app reports a network mismatch after connecting, see [Troubleshooting — Wrong Network](#wrong-network). The app blocks signing and submission until the wallet network matches the app's configured passphrase.

---

## Step 6 — Sign a Pledge

1. Click on the campaign card you created (or any open campaign) to open the detail panel.
2. Locate the **Pledge** section.
3. Enter a pledge amount (e.g., `10`) and ensure **XLM** is selected as the asset.
4. Click **Pledge**.

The app will:

- Build the `contribute` transaction using the Soroban contract
- Simulate it against the Soroban RPC to get the authorisation footprint and estimated fee
- Show you a transaction preview panel with the operation, amount, contract address, and estimated fee

> **Network check:** Before building the transaction, the app re-reads the wallet's network passphrase and compares it to the app's configured network. If they differ, the flow stops before anything is signed or submitted and shows an actionable message.

5. Review the preview. Click **Confirm** (or **Approve** — the button label matches the UI).

Freighter opens with the full transaction details for final approval.

> **Screenshot placeholder:** Freighter transaction approval popup showing operation type, amount, and network fee.

6. Click **Approve** in Freighter.

The app submits the signed XDR to Soroban RPC, polls for confirmation, and then reconciles the pledge with the backend. The campaign's pledged amount updates on screen. A transaction hash is displayed in the timeline.

> **Screenshot placeholder:** Campaign detail panel showing the updated pledge amount and transaction hash in the activity timeline.

You have successfully signed and submitted a pledge transaction on Stellar testnet.

---

## Troubleshooting

### Popup Blocked

**Symptom:** Clicking **Connect Wallet** or **Approve** does nothing. No Freighter popup appears.

**Cause:** Your browser's popup blocker is preventing the extension from opening.

**Fix:**
1. Look for a blocked popup notification in your browser's address bar (usually an icon on the right side of the URL bar).
2. Click it and select **Always allow popups from localhost**.
3. Reload the page and try again.

Alternatively, open Freighter manually via the toolbar icon before clicking **Connect Wallet** — the extension will handle the request without needing a popup.

---

### Wrong Network

**Symptom:** After connecting, the app shows an error similar to:

```
Freighter is connected to Stellar Mainnet, but this app expects Stellar Testnet.
Switch the app's network in Freighter and reconnect to continue.
```

**Cause:** Freighter is set to mainnet (or a custom network) while the app expects testnet.

**Fix:**
1. Click the gear icon in Freighter → **Network**.
2. Select **Test DF Network ;; September 2015**.
3. Click **Save** and click **Connect Wallet** in the app again.

The app reads `networkPassphrase` from Freighter on every connect attempt and re-checks it before signing, so no page reload is required.

**What the app guarantees:** While the networks differ, the pledge flow stops at the network check. No transaction is built, signed, or submitted, and the backend is not asked to reconcile anything. The inline message tells you to switch Freighter to the app's network and retry.

---

### Insufficient XLM

**Symptom:** The pledge transaction fails with an error like:

```
The network rejected transaction <hash>.
```

Or the simulation step shows a fee error before Freighter even opens.

**Cause:** Your account balance is too low to cover the transaction fee and/or the Stellar minimum reserve (1 XLM base reserve + 0.5 XLM per trustline).

**Fix:**
1. Open Freighter and check your XLM balance.
2. If it is below ~2 XLM, re-fund via Friendbot:

   ```bash
   curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
   ```

3. Wait a few seconds for the balance to update, then retry the pledge.

> **Note:** Friendbot can only fund an account once if the account already exists. If your balance is zero (account was merged or never created), paste your key into [Stellar Laboratory](https://laboratory.stellar.org/account/create?network=testnet) instead and click **Get test network lumens**.

---

### Signing error messages

Signing and submission failures are grouped into a fixed set of classes (see [`frontend/src/lib/signingErrors.ts`](../frontend/src/lib/signingErrors.ts)). The app shows the message for the class, never the raw wallet or RPC error text:

| Class | Meaning | What to do |
| --- | --- | --- |
| `USER_REJECTED` | You declined the wallet connection or the signature request | Click the button again and approve the request in your wallet |
| `WALLET_UNAVAILABLE` | Freighter is missing, locked, unreachable, or on the wrong network | Install, unlock, or switch the network, then reconnect |
| `MALFORMED_TRANSACTION` | The transaction couldn't be built, simulated, or read back from the wallet | Check the amount and campaign, reconnect the wallet, then try again |
| `RPC_FAILURE` | Soroban RPC timed out, rejected the submission transport, or stopped answering status polls | Check your connection, then retry; if a transaction hash is shown, confirm it on Stellar Expert first |
| `CONTRACT_REJECTED` | The contract or ledger executed and rejected the transaction | Check the campaign status and your balance before retrying |
| `UNKNOWN` | Anything else | Refresh the page and try again |

Each class is raised from named error codes so the UI and tests can assert the class without parsing text. The exchange paths are:

| Code | Class | Raised when |
| --- | --- | --- |
| `FREIGHTER_ACCESS_DENIED / USER_CANCELLED` | `USER_REJECTED` | The user closes or declines the wallet prompt |
| `FREIGHTER_UNAVAILABLE` | `WALLET_UNAVAILABLE` | The extension probe throws, or Freighter reports it is not connected |
| `FREIGHTER_NETWORK_MISMATCH` | `WALLET_UNAVAILABLE` | The wallet network differs from the app's configured passphrase; checked on connect and again before signing |
| `INVALID_TRANSACTION_PARAMS` | `MALFORMED_TRANSACTION` | Contract, address, or amount coercion fails while assembling the operation |
| `INVALID_SIGNED_XDR` | `MALFORMED_TRANSACTION` | The wallet returns an envelope that cannot be parsed |
| `SIMULATION_FAILED / SIMULATION_PREPARE_FAILED` | `MALFORMED_TRANSACTION` | The RPC simulation or fee assembly rejects the operation |
| `SOURCE_ACCOUNT_LOAD_FAILED / SUBMISSION_FAILED / TRANSACTION_STATUS_UNAVAILABLE / TRANSACTION_TIMEOUT` | `RPC_FAILURE` | Transport, submission, or polling fails |
| `TRANSACTION_FAILED / CONTRACT_CALL_FAILED / STATE_RESTORE_REQUIRED` | `CONTRACT_REJECTED` | The ledger executed the transaction and it failed, or the contract state must be restored |

Raw error text is kept only as a redacted diagnostic `detail`: Stellar secret seeds (`S`) and transaction XDR are stripped and the text is truncated. User-facing strings also pass through `safeErrorMessage()`, so even an unclassified SDK/wallet message is scrubbed before it reaches a toast or inline error. The backend likewise returns structured error codes and replaces unexpected exception text with `INTERNAL_SERVER_ERROR`.

---

## What Happens Under the Hood

For contributors curious about the implementation:

```
connectFreighterWallet()   → validates extension + network passphrase
        ↓
signTransaction()       → assertWalletNetwork() blocks on mismatch
        ↓
simulateTransaction()      → Soroban RPC builds fee estimate + auth footprint
        ↔
prepareTransaction()       → attaches simulation footprint to the XDR
        ↔
signTransaction()          → Freighter prompts user; returns signed XDR
        →
sendTransaction()          ↔ submits signed XDR to Soroban RPC
        ←
waitForTransaction()      → polls until confirmed or timed out
```
