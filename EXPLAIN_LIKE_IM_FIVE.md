# EXPLAIN LIKE I'M FIVE

## What problem does this repo solve?

Crowdfunding on the Stellar blockchain. **Stellar Goal Vault** lets people create fundraising campaigns with a target amount and deadline. If the goal is reached, the creator gets the funds. If not, everyone gets their money back.

## How does it work in 3 bullet points?

1. **A creator launches a campaign** — they set a funding goal (in Stellar lumens) and a deadline. The money people pledge goes into a secure vault.
2. **Supporters pledge until the deadline** — anyone can contribute. Every pledge is tracked. You can see the live progress bar filling up.
3. **All-or-nothing settlement** — if the goal is met by the deadline, the creator claims the vault. If not, every supporter gets a full refund. No one loses.

```
  ┌──────────┐          ┌─────────────┐
  │ Creator  │  Opens   │ Goal Vault │
  │          │─────────▶│             │
  │   💰     │◀─────────│  (escrow)   │
  │  Claim   │  Payout  │             │
  └──────────┘          └──────┬──────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              ┌─────▼─────┐        ┌──────▼─────┐
              │ Supporter  │  ...   │ Supporter  │
              │   (pledge) │        │  (pledge)  │
              └────────────┘        └────────────┘
```

## Who should use this?

- **Creators & builders** who want to raise funds on Stellar without a middleman
- **Community members** who want to back Stellar projects with real skin in the game
- **Web3 developers** learning Soroban contract patterns (escrow, time-based claims, refunds)
- **Anyone testing Stellar crowdfunding** before building a production-grade platform
