# Multi-Token Support Design Decision

## Problem Statement

Each campaign is currently tied to a single token at creation time. There is no option to accept contributions in secondary tokens, limiting the flexibility of crowdfunding campaigns on Stellar.

## Proposed Solutions

### Option 1: Extend Campaign Model to Support Multiple Accepted Tokens

**Implementation Approach:**
- Modify the `Campaign` struct in the Soroban contract to include `accepted_tokens: Vec<Address>` instead of a single `token: Address`
- Update `create_campaign` to accept a list of accepted tokens
- Modify `contribute` to accept a `token: Address` parameter and validate it against `accepted_tokens`
- Track pledged amounts per token separately
- Define how the target amount is evaluated (sum of all contributions? conversion to base value?)

**Challenges:**
1. **Valuation Complexity**: How to determine if the campaign target is met when contributions are in different tokens?
   - Option A: Sum all contributions in their native tokens (requires target to be per-token)
   - Option B: Convert all contributions to a base value using price feeds (requires oracle integration)
   - Option C: Primary token target, secondary tokens as bonus contributions

2. **Contract Complexity**: Need to track contributions per token, modify storage keys, update invariants

3. **Claim Logic**: How to transfer funds when claiming? Transfer all tokens to creator?

4. **Refund Logic**: Refunds need to return the correct token

5. **UI Complexity**: Contributors need to choose which token to contribute with

### Option 2: Single Token Per Campaign (Current Approach)

**Pros:**
- Simple contract logic
- Clear valuation (all amounts in same token)
- Straightforward claiming and refunding
- Easy to understand for users

**Cons:**
- Limited flexibility for creators
- Contributors must hold the specific token
- May reduce participation if token is illiquid

### Option 3: Token Conversion at Contribution Time

**Implementation:**
- Campaign specifies primary token and accepted secondary tokens
- At contribution time, automatically convert secondary token contributions to primary token using an oracle
- All accounting in primary token

**Challenges:**
- Requires reliable price feeds/oracles
- Introduces slippage and conversion fees
- Additional complexity in contribution flow
- Oracle dependency for core functionality

## Final Decision: Implement Option 1 (Multi-Token Support)

**Rationale:**
1. **Flexibility**: Allowing multiple tokens increases the potential for campaign success by letting contributors use their preferred assets.
2. **Standardization**: Implementing this at the contract level ensures consistent behavior across different frontends.
3. **Future-Proofing**: While simple now, this architecture allows for future integration with price oracles for more complex valuation.

## Implementation Details

### Contract Architecture
- **Storage Keys**:
  - `Contribution(u64, Address, Address)`: Tracks contributions per campaign, contributor, and token.
  - `CampaignTokenBalance(u64, Address)`: Tracks total pledged amount for each token in a campaign.
- **Valuation Strategy**: 
  - `pledged_amount` in the `Campaign` struct is a raw sum of all token amounts.
  - **Tradeoff**: This assumes a 1:1 value ratio for all accepted tokens in terms of meeting the `target_amount`. Creators should only accept tokens of similar value (e.g., various USD stablecoins) or understand that the target is a sum of units.
- **Claim Flow**: The `claim` function iterates over all `accepted_tokens` and transfers the full balance of each token to the creator.
- **Refund Flow**: The `refund` function iterates over all `accepted_tokens` and returns the specific tokens contributed by the user.

### API for Integrators

#### Campaign Creation
```json
{
  "creator": "G...",
  "accepted_tokens": ["USDC:GA...", "PYUSD:GA..."],
  "target_amount": 1000,
  "deadline": 1234567890,
  "metadata": "..."
}
```

#### Contribution
```json
{
  "campaign_id": 1,
  "contributor": "G...",
  "token": "USDC:GA...",
  "amount": 100
}
```

#### Querying
- `get_contribution(campaign_id, contributor, token)`: Returns the amount of a specific token pledged by a contributor.
- `get_campaign_token_balance(campaign_id, token)`: Returns the total amount of a specific token pledged to the campaign.

## Conclusion

Multi-token support has been implemented to provide maximum flexibility for crowdfunding on Stellar. The current valuation strategy is simple (1:1 unit sum), which is suitable for campaigns using similar-value assets. For campaigns requiring diverse assets (e.g., XLM and USDC), integrators should be aware that the `target_amount` is calculated as a raw sum of units.
</content>
<parameter name="filePath">/home/robi/Desktop/stellar-goal-vault/MULTI_TOKEN_DESIGN_DECISION.md