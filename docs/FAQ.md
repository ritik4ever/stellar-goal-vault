# Frequently Asked Questions

## Getting Started

### How do I set up the project locally?
Follow the instructions in [`CONTRIBUTING.md`](../CONTRIBUTING.md). You'll need Node.js 20+, a Stellar Testnet account, and Freighter wallet.

### How do I get Testnet XLM?
1. Install [Freighter](https://freighter.app/) wallet extension
2. Switch to **Testnet** mode in Freighter settings
3. Visit the [Stellar Lab Friendbot](https://laboratory.stellar.org/#account-creator?network=test)
4. Enter your `G…` public address to receive 10,000 free test XLM

### Why is my signature rejected?
- Ensure you're using the correct Stellar account (the one you pledged with)
- Make sure your Freighter wallet is unlocked and on Testnet
- Try refreshing the page and reconnecting your wallet

## Campaigns

### How do I create a campaign?
Navigate to the "Create Campaign" page, fill in the title, description, target amount, deadline, and token details. Sign the transaction with Freighter to submit.

### Can I edit a campaign after creation?
Campaign metadata (title, description) can be updated by the creator before the first pledge. Campaign goal and deadline changes require DAO governance or creator override depending on configuration.

### What happens if my campaign doesn't reach its goal?
If the goal isn't met by the deadline, backers can claim a refund through the `refund` contract function. The campaign enters a "failed" state.

## Pledging

### Can I cancel a pledge?
Pledges are locked once made. If the campaign fails to reach its goal, you can claim a refund through the `refund` function.

### Is there a minimum pledge amount?
There is no enforced minimum, but very small amounts may not be economical due to network transaction fees.

## Technical

### How do I reset the campaign store?
```bash
# Reset the backend data store
rm -f backend/data/campaigns.json
```

### How do I run tests?
```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# Contract tests
cd contracts && cargo test
```

### How do I check contract version?
Call the `get_version()` view function on the deployed Soroban contract.

## Troubleshooting

### "Cannot read properties of undefined" in campaign list
This usually means the backend is not running. Ensure both backend and frontend servers are started.

### Freighter doesn't prompt for signature
- Make sure Freighter is unlocked
- Check that you're on the correct network (Testnet for dev)
- Try refreshing the page

### Backend fails to start
Check that you have a `.env` file with required variables. Copy `.env.example` to `.env` and fill in the values.
