# Workflow Document: Conditional Matching Grants (#554)

## Overview
This workflow describes the design, implementation, and lifecycle of **Conditional Matching Grants** introduced into the `stellar-goal-vault` Soroban smart contracts (Issue #554).

## Architecture & Data Flow

```
[ Sponsor ] ─── create_matching_grant() ───► [ Vault Contract Escrow ]
                                                    │
                      ┌─────────────────────────────┴─────────────────────────────┐
                      ▼                                                           ▼
         Campaign Meets Target & Min Target                         Campaign Fails or Expire
                      │                                                           │
              claim_campaign()                                          refund_matching_grant()
                      │                                                           │
         ┌────────────┴────────────┐                                              │
         ▼                         ▼                                              ▼
[ Campaign Creator ]      [ Sponsor Return ]                             [ Sponsor Return ]
(Pledged + Matched)       (Unused Match Escrow)                          (Full Match Escrow)
```

## Lifecycle Steps

### 1. Grant Creation (`create_matching_grant`)
- **Action**: Sponsor creates a matching grant bound to a campaign ID.
- **Parameters**:
  - `sponsor`: Address of the matching grant funder.
  - `campaign_id`: ID of the campaign to match.
  - `token`: Address of the token being matched (must be an accepted token of the campaign).
  - `match_ratio_num` & `match_ratio_den`: Matching ratio parameters (e.g. `1:1` ratio is `num=1, den=1`).
  - `max_match_cap`: Maximum match cap to be funded by sponsor.
  - `min_campaign_target`: Minimum campaign target required for campaign to qualify for matching.
- **Escrow Locking**: The contract immediately transfers `max_match_cap` of `token` from `sponsor` to the contract escrow.
- **Events**: Emits `(Match, Create)` event (`MatchingGrantCreated`).

### 2. Campaign Contribution Phase
- Contributors make standard contributions to the campaign via `contribute()`.

### 3. Claim & Match Release Phase (`claim`)
- When the campaign creator claims a successful campaign via `claim()`:
  - Contract verifies if campaign pledged amount meets `min_campaign_target`.
  - **Qualification**: If `pledged_amount >= min_campaign_target`, match is calculated:
    $$\text{matched\_amount} = \min\left(\frac{\text{pledged\_amount} \times \text{match\_ratio\_num}}{\text{match\_ratio\_den}}, \text{max\_match\_cap}\right)$$
  - **Release**: `matched_amount` is transferred from escrow to `creator`.
  - **Unused Match Return**: Remaining unused escrow ($\text{total\_match\_locked} - \text{matched\_amount}$) is automatically returned to `sponsor`.
  - **Events**: Emits `(Match, Release)` and `(Match, Refund)` events.

### 4. Non-Qualifying / Expired Refund Phase (`refund_matching_grant`)
- If the campaign fails to reach its target or deadline passes without a claim, or if campaign is canceled:
  - Sponsor calls `refund_matching_grant()`.
  - Contract returns 100% of remaining escrowed match funds to `sponsor`.
  - Marks grant as refunded.
  - **Events**: Emits `(Match, Refund)` event (`MatchingGrantRefunded`).

## Acceptance Criteria Summary
- ✅ **Non-qualifying campaigns don't receive match**: If pledged amount is below `min_campaign_target`, matched amount is 0 and escrow is returned to sponsor.
- ✅ **Match cap enforced precisely**: Released match is capped strictly at `max_match_cap`.
- ✅ **Unused match returned to sponsor after campaign deadline**: Any remaining escrow is returned to sponsor either on claim or via `refund_matching_grant`.
