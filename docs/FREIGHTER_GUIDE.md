# Freighter Pledge Signing Walkthrough

This guide walks you through the full pledge flow in Stellar Goal Vault — from installing Freighter to signing a pledge transaction on Stellar testnet. Follow it end-to-end and you will have made a real on-chain contribution without needing a funded mainnet account.

---

## Prerequisites

- Google Chrome or Firefox
- The app running locally (`npm run dev` in both `backend/` and `frontend/`)
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
3. Choose **Test SDF Network ; September 2015** (the testnet option).
4. Click **Save**.

The Freighter header should now show **TESTNET** in the network badge.

> **Screenshot placeholder:** Freighter network selector showing Testnet selected.

---

## Step 3 — Fund Your Testnet Wallet

Testnet XLM is free. Stellar's Friendbot will credit 10,000 XLM to any new testnet address.

1. In Freighter, copy your public key. It starts with `G` and is about 56 characters long. Click your address in the header to copy it.

2. Open the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/account/create?network=testnet) in a new tab.

3. Paste your public key into the **Public Key** field and click **Get test network lumens**.

   Alternatively, fund via the API directly:

   ```bash
   curl "https://friendbot.stellar.org?addr=YOUR_PUBLIC_KEY"
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

---

## Step 6 — Sign a Pledge

1. Click on the campaign card you created (or any open campaign) to open the detail panel.
2. Locate the **Pledge** section.
3. Enter a pledge amount (e.g., `10`) and ensure **XLM** is selected as the asset.
4. Click **Pledge**.

The app will:

- Build the `contribute` transaction using the Soroban contract
- Simulate it against the Soroban RPC to get the authorisation footprint and estimated fee
- Show you a **transaction preview panel** with the operation, amount, contract address, and estimated fee

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
```

**Cause:** Freighter is set to mainnet (or a custom network) while the app expects testnet.

**Fix:**
1. Click the gear icon in Freighter → **Network**.
2. Select **Test SDF Network ; September 2015**.
3. Click **Save** and click **Connect Wallet** in the app again.

The app reads `networkPassphrase` from Freighter on every connect attempt, so no page reload is required.

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

## What Happens Under the Hood

For contributors curious about the implementation:

```
connectFreighterWallet()   → validates extension + network passphrase
        ↓
simulateTransaction()      → Soroban RPC builds fee estimate + auth footprint
        ↓
prepareTransaction()       → attaches simulation footprint to the XDR
        ↓
signTransaction()          → Freighter prompts user; returns signed XDR
        ↓
sendTransaction()          → submits signed XDR to Soroban RPC
        ↓
waitForTransaction()       → polls until SUCCESS or FAILED (25 attempts, 1.2 s each)
        ↓
POST /api/campaigns/:id/pledges/reconcile   → backend records confirmed hash in SQLite
```

The full implementation lives in [`frontend/src/services/freighter.ts`](../frontend/src/services/freighter.ts).

---

## Related Resources

- [Freighter documentation](https://docs.freighter.app/docs/guide/usingFreighterBrowser)
- [Stellar Laboratory](https://laboratory.stellar.org)
- [Stellar testnet Friendbot](https://friendbot.stellar.org)
- [ADR 0003 — Freighter Wallet Integration](../adr/0003-freighter-wallet-integration.md)
- [FAQ #2 — How do I set up Freighter?](../FAQ.md#2-how-do-i-set-up-freighter-wallet-for-pledge-transactions)
