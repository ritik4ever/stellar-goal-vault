# 0006 - Multi-Token Campaign Design

## Context

Campaigns in the MVP initially supported a single accepted token (`assetCode`). Contributors could only pledge one type of asset per campaign, limiting flexibility for campaigns that wanted to accept multiple Stellar assets (e.g., USDC and XLM).

Three approaches were considered:

1. **Multi-token support (extend contract model)** — Modify the `Campaign` struct to hold `accepted_tokens: Vec<Address>`. Track pledges per token. Claim iterates over all accepted tokens and transfers each balance. Refund returns the specific token contributed.

2. **Single token per campaign (status quo)** — Each campaign accepts exactly one token. Simple contract logic and clear valuation, but contributors must hold the specific token, which may reduce participation.

3. **Token conversion at contribution time** — Campaign specifies a primary token and secondary tokens. Secondary contributions are automatically swapped to the primary token via an oracle integration at contribution time. All accounting is in the primary token.

## Decision

Adopt **Option 1: Multi-token support**.

The Soroban contract stores `accepted_tokens: Vec<Address>` on each campaign (Soroban-native address type identifying each token's on-chain contract). The `contribute` function validates that the pledged asset address is in the accepted list before recording the pledge. Pledged amounts are tracked per token using `Contribution(u64, Address, Address)` and `CampaignTokenBalance(u64, Address)` storage keys.

**Canonical token identity**: The project defines a single canonical token identifier format to prevent balances from being incorrectly merged or split across different issuers or contract addresses:

- **Classic Stellar assets**: `CODE:ISSUER` (e.g., `USDC:GA5ZSE...`). The asset code of up to 12 characters and the issuing account's public key are combined with a colon separator. This resolves ambiguity when multiple issuers use the same asset code. **Important**: `CODE:ISSUER` is an off-chain canonical identifier only. Before use in any on-chain contribution flow, it must be resolved to a Soroban contract address via the existing `config.assetAddresses[assetCode]` lookup. The `CODE:ISSUER` format is used for pledge validation, token balance grouping, and analytics; it never appears in Soroban contract calls directly.
- **Native XLM**: `XLM` (no issuer component). XLM is the native Stellar asset and is represented by the string `"XLM"` as its canonical token ID. Its Soroban contract address is resolved via the same `config.assetAddresses` lookup.
- **Soroban-native tokens**: The token's Soroban contract address directly (e.g., `C...`). These addresses double as both off-chain canonical IDs and on-chain contract identifiers.

On-chain, all token identities map to a Soroban `Address` type via the asset-address lookup. Off-chain, the backend stores canonical IDs in `accepted_tokens_json` and groups pledges by `token_id` (the canonical identifier stored alongside the legacy `asset_code` column). The `token_id` column in the `pledges` table holds the canonical identifier; `asset_code` is retained as a denormalized shorthand for backward compatibility. When `token_id` is not provided (legacy data), the system falls back to `asset_code`.

Valuation uses a simple 1:1 unit sum — `pledged_amount` is the raw sum of all token amounts. Creators should only accept tokens of similar value (e.g., stablecoins) or understand that the target is a sum of units. This avoids oracle complexity for the MVP while leaving room for price-feed integration later.

The full design rationale, including storage schema, API contracts, and trade-offs, is documented in `MULTI_TOKEN_DESIGN_DECISION.md`.

## Consequences

- **Flexibility for creators** — campaigns can accept any combination of Stellar assets, increasing the likelihood of reaching funding targets.
- **Consistent contract behavior** — multi-token support is enforced at the Soroban contract level, so all frontends behave the same way.
- **UI complexity** — the frontend renders a token selector when `acceptedTokens.length > 1` and displays per-token progress bars (`CampaignCard` shows individual `<div class="progress-bar">` elements).
- **Valuation caveat** — the 1:1 unit sum means a campaign accepting both USDC and XLM would count 1 USDC == 1 XLM toward the target. Integrators must understand this limitation.
- **Decimal-scale normalization** — contributions across tokens with different decimal scales (e.g., a 7-decimal asset vs. an 18-decimal asset) must be normalized to a common unit before being summed into `pledged_amount`. Raw unit-sum comparison against `target_amount` is only valid when all accepted tokens share the same decimal scale — otherwise the arithmetic is meaningless. Campaign creators are responsible for accepting only tokens of compatible decimal scales, or the system must reject mixed-scale configurations at campaign creation time. Full decimal-aware normalization is tracked as a future refinement.
- **Campaign-level token identity gap** — `accepted_tokens_json` currently stores uppercase asset codes without issuer info (e.g., `["USDC"]`), so campaign acceptance validation cannot distinguish between the same asset code from different issuers. The canonical `token_id` (with issuer) is enforced at the pledge level only. Full issuer-aware campaign token acceptance is tracked as a future refinement.
- **Backend tracking** — `getCampaignTokenBalances(campaignId)` queries the `pledges` table grouped by `token_id` (the canonical identifier). When `token_id` is `NULL` (legacy records), the query falls back to `asset_code`. **Legacy caveat**: legacy-backfilled `token_id` values (e.g., bare asset codes like `"USDC"` without an issuer, set by the migration `UPDATE pledges SET token_id = asset_code WHERE token_id IS NULL`) are NOT canonical and must not be treated as issuer-aware. These entries are explicitly bucketed as "legacy/unknown" — the `COALESCE(token_id, asset_code)` grouping can merge balances across different issuers of the same asset code. Integrators relying on token-level granularity must ensure all data uses canonical `CODE:ISSUER` or contract-address identifiers. The `tokenBalances` map is keyed by the canonical token ID and returned on every campaign read. Legacy data without `token_id` is automatically backfilled by the database migration.

## References

- `MULTI_TOKEN_DESIGN_DECISION.md` — full design document with alternatives, storage schema, and API payloads
- `contracts/` — Soroban contract with multi-token campaign creation and contribution validation
- `frontend/src/components/CampaignCard.tsx` — per-token progress bars
- `frontend/src/components/CampaignDetailPanel.tsx` — token selector in pledge form
- `backend/src/services/campaignStore.ts` — `getCampaignTokenBalances` implementation
- `adr/0001-sqlite-off-chain-mvp.md` — off-chain state tracking for pledges
- `adr/0005-soroban-smart-contract-platform.md` — platform context for contract decisions
