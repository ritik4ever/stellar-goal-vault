# Stellar Goal Vault — Contract ABI Reference

**Contract:** `StellarGoalVaultContract`
**Language:** Rust (Soroban SDK 21.0.0)
**Deployment target:** Stellar Soroban
**Version:** 0.1.0

---

## Table of Contents

1. [Type Definitions](#type-definitions)
2. [Administration](#administration)
3. [Campaign Lifecycle](#campaign-lifecycle)
4. [Contributions & Funds](#contributions--funds)
5. [Governance](#governance)
6. [Read-Only Queries](#read-only-queries)
7. [Events](#events)
8. [Error Codes Reference](#error-codes-reference)
9. [Gas Estimates](#gas-estimates)
10. [Worked Examples](#worked-examples)

---

## Type Definitions

### `Campaign`

| Field | Type | Description |
|-------|------|-------------|
| `creator` | `Address` | Campaign creator's Stellar address |
| `accepted_tokens` | `Vec<Address>` | List of token addresses this campaign accepts (max 10) |
| `target_amount` | `i128` | Funding goal in stroops (1 stroop = 1e-7 lumen) |
| `pledged_amount` | `i128` | Total amount pledged across all tokens |
| `deadline` | `u64` | Unix timestamp (seconds) when the campaign ends |
| `claimed` | `bool` | Whether the creator has claimed the funds |
| `canceled` | `bool` | Whether the campaign was canceled by the creator |
| `metadata` | `String` | Arbitrary metadata string (campaign description, URI, etc.) |
| `contributor_count` | `u32` | Number of unique contributors |
| `created_at` | `u64` | Unix timestamp of campaign creation |

### `DeployInfo`

| Field | Type | Description |
|-------|------|-------------|
| `version` | `String` | Contract version from `CARGO_PKG_VERSION` |
| `deployed_at` | `u64` | Unix timestamp of first `get_deploy_info()` call |

### `ExtensionRequest`

| Field | Type | Description |
|-------|------|-------------|
| `new_deadline` | `u64` | Proposed new deadline timestamp |
| `requested_by` | `Address` | Contributor who requested the extension |
| `approval_count` | `u32` | Number of approval votes received |

### Campaign Event Structs

See [Events](#events) section for all event payloads.

---

## Administration

### `initialize`

Sets the admin address and minimum contribution floor. One-time setup — panics if called twice.

```
fn initialize(env: Env, admin: Address, min_contribution: i128)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Admin Stellar address (cannot be changed later) |
| `min_contribution` | `i128` | Minimum contribution amount in stroops (must be > 0) |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Already initialized | `"already initialized"` | High | Do not call again; contract is already set up |
| `min_contribution <= 0` | `"min_contribution must be positive"` | High | Call with a positive integer (minimum 1 stroop) |
| Caller not authorized | Soroban auth failure | High | Ensure caller signs with the `admin` address |

**Gas estimate:** 15,000 + 5,000 per storage write (~20,000 units total + 20% headroom = **24,000**)

---

### `set_paused`

Pauses or unpauses all state-mutating entry points. Admin only.

```
fn set_paused(env: Env, caller: Address, paused: bool)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | `Address` | Must match the stored admin address |
| `paused` | `bool` | `true` to pause, `false` to unpause |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Not initialized | `"not initialized"` | High | Call `initialize()` first |
| Caller is not admin | `"caller is not admin"` | Critical | Only the admin address stored during `initialize()` can call this |

**Emits:** `ContractPaused` or `ContractUnpaused`

**Gas estimate:** 12,000 + event cost (~4,000) ≈ 16,000 units + 20% headroom = **19,200**

---

## Campaign Lifecycle

### `create_campaign`

Creates a new fundraising campaign. Returns the unique numeric campaign ID.

```
fn create_campaign(
    env: Env,
    creator: Address,
    accepted_tokens: Vec<Address>,
    target_amount: i128,
    deadline: u64,
    metadata: String,
    max_per_contributor: i128,
) -> u64
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `creator` | `Address` | Campaign creator's address (must authenticate) |
| `accepted_tokens` | `Vec<Address>` | Token addresses this campaign accepts (1–10) |
| `target_amount` | `i128` | Funding goal in stroops (must be > 0) |
| `deadline` | `u64` | Unix deadline timestamp (must be in the future, ≤180 days from now) |
| `metadata` | `String` | Campaign metadata (description, URI, etc.) |
| `max_per_contributor` | `i128` | Per-contributor cap (0 = no cap, must not be negative) |

**Returns:** `u64` — sequential campaign ID (1-based, auto-incremented)

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Non-positive target | `"target amount must be positive"` | High | Set `target_amount` to a value > 0 |
| Deadline in the past | `"deadline must be in the future"` | Medium | Set a deadline timestamp after the current ledger time |
| Deadline > 180 days | `"deadline exceeds maximum campaign duration"` | Medium | Set deadline within 180 days (15,552,000 seconds) of now |
| Empty tokens list | `"accepted_tokens must not be empty"` | High | Provide at least one valid token address |
| Duplicate token | `"duplicate token addresses"` | Medium | Remove duplicate token entries |
| Too many tokens (>10) | `"too many accepted tokens"` | Medium | Limit `accepted_tokens` to 10 or fewer |
| Negative per-contributor cap | `"max_per_contributor must not be negative"` | Low | Use 0 for no cap or a positive integer |
| Caller not authorized | Soroban auth failure | High | Ensure `creator` signs the transaction |

**Emits:** `CampaignCreated` (with the first token from the accepted list)

**Gas estimate:** base 25,000 + 3,000 per accepted token + 5,000 per storage write ≈ 45,000 units + 20% headroom = **54,000**

---

### `cancel_campaign`

Cancels an active (unclaimed) campaign, allowing contributors to claim refunds. Creator only.

```
fn cancel_campaign(env: Env, campaign_id: u64, creator: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign to cancel |
| `creator` | `Address` | Must match the campaign's stored creator |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` exists via `get_campaign()` |
| Creator mismatch | `"creator mismatch"` | Critical | Only the original `creator` address can cancel |
| Already claimed | `"campaign already claimed"` | Medium | Funds already withdrawn; no cancellation possible |
| Already canceled | `"campaign already canceled"` | Low | Campaign is already in a canceled state |

**Emits:** `CampaignCanceled`

**Gas estimate:** 14,000 + event ≈ 18,000 units + 20% headroom = **21,600**

---

### `update_metadata`

Updates the campaign metadata string. Creator only, before deadline.

```
fn update_metadata(env: Env, campaign_id: u64, creator: Address, new_metadata: String)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign to update |
| `creator` | `Address` | Must match the campaign's stored creator |
| `new_metadata` | `String` | Replacement metadata string |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Creator mismatch | `"creator mismatch"` | Critical | Only the original creator can update metadata |
| Already claimed | `"campaign already claimed"` | Medium | Cannot update metadata after claim |
| Campaign canceled | `"campaign canceled"` | Low | Campaign is terminated |
| Past deadline | `"campaign deadline reached"` | Medium | Metadata cannot be updated after the deadline |

**Emits:** `MetadataUpdated`

**Gas estimate:** 16,000 + storage write + event ≈ 22,000 units + 20% headroom = **26,400**

---

## Contributions & Funds

### `contribute`

Contribute tokens to a campaign. Tokens are transferred from the contributor to the contract.

```
fn contribute(env: Env, campaign_id: u64, contributor: Address, token: Address, amount: i128)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | Target campaign ID |
| `contributor` | `Address` | Contributor's address (must authenticate and have token balance) |
| `token` | `Address` | Token contract address (must be in campaign's `accepted_tokens`) |
| `amount` | `i128` | Amount to contribute in stroops |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Below minimum contribution | `"contribution below minimum"` | Medium | Increase amount to at least `get_min_contribution()` |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Already claimed | `"campaign already claimed"` | Medium | Campaign has ended; cannot contribute |
| Campaign canceled | `"campaign canceled"` | Medium | Campaign was canceled; use `refund()` if you already contributed |
| Deadline passed | `"campaign deadline reached"` | Medium | Campaign funding period has ended |
| Funding cap exceeded | `"campaign funding cap exceeded"` | Medium | Campaign has reached its `target_amount`; wait for next campaign |
| Token not accepted | `"token not accepted by this campaign"` | Medium | Contribute one of `campaign.accepted_tokens` |
| Per-contributor cap exceeded | Soroban arithmetic panic | Medium | Check `max_per_contributor` set at campaign creation |
| Insufficient token balance | Soroban token transfer error | High | Ensure contributor has enough tokens and has approved transfer |
| Caller not authorized | Soroban auth failure | High | Ensure `contributor` signs the transaction |

**Emits:** `CampaignPledged`

**Gas estimate:** 30,000 + token transfer cost (~10,000) + storage writes ≈ 50,000 units + 20% headroom = **60,000**

---

### `claim`

Creators claim all accumulated funds after a successful campaign (deadline passed and target met).

```
fn claim(env: Env, campaign_id: u64, creator: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the funded campaign |
| `creator` | `Address` | Must match the campaign's stored creator |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Creator mismatch | `"creator mismatch"` | Critical | Only the original creator can claim |
| Already claimed | `"campaign already claimed"` | Medium | Funds already withdrawn |
| Campaign canceled | `"campaign canceled"` | Medium | Campaign was canceled; no funds to claim |
| Still active | `"campaign is still active"` | Medium | Wait for deadline to pass |
| Underfunded | `"campaign is not funded"` | Medium | `pledged_amount < target_amount`; contributors should use `refund()` |

**Emits:** `CampaignClaimed` (one per token with a non-zero balance)

**Gas estimate:** 20,000 + 15,000 per accepted token (transfer + storage) ≈ base 20,000 + 15,000 per token + 20% headroom: **42,000** (1 token) / **102,000** (5 tokens)

---

### `refund`

Individual contributor refund after campaign cancellation or underfunded deadline expiry.

```
fn refund(env: Env, campaign_id: u64, contributor: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign to refund from |
| `contributor` | `Address` | Contributor's address (must have contributed) |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Already claimed | `"campaign already claimed"` | Medium | Funds already withdrawn; no refunds possible |
| Still active (not canceled) | `"campaign is still active"` | Medium | Wait for deadline or campaign cancellation |
| Campaign is funded (not canceled) | `"funded campaigns cannot be refunded"` | Medium | Campaign met its target; creator can claim |
| Nothing to refund | `"nothing to refund"` | Low | Contributor had no contributions to this campaign |
| Insufficient contract balance | Soroban token transfer error | Critical | Contract does not hold enough tokens; investigate |

**Emits:** `CampaignRefunded` (one per token the contributor used)

**Gas estimate:** 22,000 + 12,000 per token contributed ≈ base 22,000 + 12,000 per token + 20% headroom: **40,800** (1 token) / **74,400** (3 tokens)

---

### `refund_all`

Batch refund all contributors at once. Intended for admin/automation use after a failed or canceled campaign.

```
fn refund_all(env: Env, campaign_id: u64)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign to refund all contributors from |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Already claimed | `"campaign already claimed"` | Medium | Funds already withdrawn |
| Still active (not canceled) | `"campaign is still active"` | Medium | Wait for deadline or cancellation |
| Campaign is funded (not canceled) | `"funded campaigns cannot be refunded"` | Medium | Campaign met its target |
| Nothing to refund (no contributors) | `"nothing to refund"` | Low | No contributors found |

**Emits:** `CampaignRefunded` (one per contributor per token)

**Gas estimate:** 15,000 base + 25,000 per contributor ≈ highly variable. For 10 contributors with 1 token each: **290,000** + 20% headroom = **348,000**

---

### `migrate`

Admin-only bulk migration of campaign records from an old contract instance. Idempotent — already-migrated source IDs are silently skipped.

```
fn migrate(
    env: Env,
    admin: Address,
    old_contract_id: Address,
    source_ids: Vec<u64>,
    campaigns: Vec<Campaign>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must match the stored admin address |
| `old_contract_id` | `Address` | Contract ID of the old/previous instance |
| `source_ids` | `Vec<u64>` | Original campaign IDs from the old contract |
| `campaigns` | `Vec<Campaign>` | Campaign structs pre-fetched from the old contract (must match `source_ids` length) |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Not initialized | `"not initialized"` (assert) | High | Call `initialize()` first |
| Caller not admin | `"only admin can call migrate"` (assert) | Critical | Only the stored admin can migrate |
| Length mismatch | `"source_ids and campaigns must have the same length"` (assert) | High | Ensure both vectors have equal length |
| Caller not authorized | Soroban auth failure | High | Ensure `admin` signs the transaction |

**Emits:** `Migrated` (one per newly imported campaign)

**Gas estimate:** 12,000 base + 8,000 per campaign ≈ 12,000 + 8,000 × _n_ + 20% headroom. For 10 campaigns: **105,600**

---

## Governance

### `request_deadline_extension`

Propose a deadline extension for a campaign. The caller must be an existing contributor. The requester auto-approves their own request.

```
fn request_deadline_extension(
    env: Env,
    campaign_id: u64,
    caller: Address,
    new_deadline: u64,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign to extend |
| `caller` | `Address` | Contributor's address (must have a positive contribution) |
| `new_deadline` | `u64` | Proposed new deadline (must be after current, within 180 days of campaign creation) |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Already claimed | `"campaign already claimed"` | Medium | Campaign has ended |
| Campaign canceled | `"campaign canceled"` | Medium | Campaign is terminated |
| Deadline not later | `"new deadline must be after current deadline"` | Low | Choose a timestamp after the current deadline |
| Exceeds max duration | `"new deadline exceeds maximum campaign duration"` | Low | Limit extension to within 180 days of campaign creation |
| Not a contributor | `"caller is not a contributor"` | Medium | Only existing contributors can request extensions |
| Caller not authorized | Soroban auth failure | High | Ensure `caller` signs the transaction |

**Emits:** `ExtensionRequested`

**Gas estimate:** 18,000 + storage writes + event ≈ 26,000 units + 20% headroom = **31,200**

---

### `approve_extension`

Vote to approve a pending deadline extension. When approvals exceed 50% of the contributor count, the new deadline is applied and the pending request is cleared.

```
fn approve_extension(env: Env, campaign_id: u64, caller: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | ID of the campaign with a pending extension request |
| `caller` | `Address` | Contributor's address (must not have already voted) |

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Contract paused | `"contract is paused"` | Medium | Wait for admin to unpause |
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` |
| Already claimed | `"campaign already claimed"` | Medium | Campaign has ended |
| Campaign canceled | `"campaign canceled"` | Medium | Campaign is terminated |
| Not a contributor | `"caller is not a contributor"` | Medium | Only existing contributors can vote |
| Already voted | `"already voted"` | Low | Each contributor votes once per extension request |
| No pending request | `"no extension request"` | Low | Call `request_deadline_extension()` first |
| Caller not authorized | Soroban auth failure | High | Ensure `caller` signs the transaction |

**Gas estimate:** 20,000 + storage write + conditional deadline apply + event ≈ 30,000 units + 20% headroom = **36,000**

---

## Read-Only Queries

### `get_campaign`

Returns the full `Campaign` struct for a given ID.

```
fn get_campaign(env: Env, campaign_id: u64) -> Campaign
```

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Campaign not found | `"campaign not found"` | High | Verify `campaign_id` via `get_campaign_count()` |

**Gas estimate:** 3,000 + storage read ≈ 5,000 units + 20% headroom = **6,000**

---

### `get_contribution`

Returns the amount a specific contributor has contributed using a specific token.

```
fn get_contribution(env: Env, campaign_id: u64, contributor: Address, token: Address) -> i128
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `contributor` | `Address` | Contributor's address |
| `token` | `Address` | Token address |

**Returns:** `i128` — contribution amount in stroops (0 if none)

**Gas estimate:** 3,500 + storage read ≈ 5,000 units + 20% headroom = **6,000**

---

### `get_campaign_token_balance`

Returns the total balance of a specific token held for a campaign.

```
fn get_campaign_token_balance(env: Env, campaign_id: u64, token: Address) -> i128
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `token` | `Address` | Token address |

**Returns:** `i128` — token balance held by the contract for this campaign (0 if none)

**Gas estimate:** 3,000 + storage read ≈ 4,500 units + 20% headroom = **5,400**

---

### `get_contributor_count`

Returns the number of unique contributors to a campaign.

```
fn get_contributor_count(env: Env, campaign_id: u64) -> u32
```

**Gas estimate:** 3,000 + storage read ≈ 5,000 units + 20% headroom = **6,000**

---

### `get_min_contribution`

Returns the current minimum contribution threshold in stroops. Defaults to 100 if `initialize()` was not called.

```
fn get_min_contribution(env: Env) -> i128
```

**Gas estimate:** 2,500 + storage read ≈ 4,000 units + 20% headroom = **4,800**

---

### `get_paused`

Returns whether the contract is currently paused.

```
fn get_paused(env: Env) -> bool
```

**Gas estimate:** 2,000 + storage read ≈ 3,000 units + 20% headroom = **3,600**

---

### `get_admin`

Returns the stored admin address. Panics if not initialized.

```
fn get_admin(env: Env) -> Address
```

**Errors:**

| Error Condition | Panic Message | Severity | Recovery Action |
|----------------|---------------|----------|-----------------|
| Not initialized | `"not initialized"` | High | Call `initialize()` first |

**Gas estimate:** 2,500 + storage read ≈ 4,000 units + 20% headroom = **4,800**

---

### `get_next_campaign_id`

Returns the next campaign ID that will be assigned. Also used as the campaign count (sequential 1-based IDs).

```
fn get_next_campaign_id(env: Env) -> u64
```

**Returns:** `u64` — next available campaign ID (0 before any campaign is created)

**Gas estimate:** 2,500 + storage read ≈ 4,000 units + 20% headroom = **4,800**

---

### `get_campaign_count`

Returns the total number of campaigns created. Equivalent to `get_next_campaign_id()`.

```
fn get_campaign_count(env: Env) -> u64
```

**Gas estimate:** 2,500 + storage read ≈ 4,000 units + 20% headroom = **4,800**

---

### `get_version`

Returns the contract version string.

```
fn get_version(env: Env) -> String
```

**Gas estimate:** 3,000 + conditional storage write (first call only) ≈ 5,000 units + 20% headroom = **6,000**

---

### `get_deploy_info`

Returns version and deployment timestamp.

```
fn get_deploy_info(env: Env) -> DeployInfo
```

**Gas estimate:** 4,000 + storage reads + conditional storage write ≈ 7,000 units + 20% headroom = **8,400**

---

### `get_extension_request`

Returns the pending extension request for a campaign, if one exists.

```
fn get_extension_request(env: Env, campaign_id: u64) -> Option<ExtensionRequest>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |

**Returns:** `Option<ExtensionRequest>` — `Some(request)` if a pending request exists, `None` otherwise

**Gas estimate:** 3,000 + storage read ≈ 5,000 units + 20% headroom = **6,000**

---

## Events

All events use the topic prefix `(symbol_short!("Goal"), ...)`.

### `CampaignCreated`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Create"` |

**Data** (`CampaignCreated`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Newly created campaign ID |
| `creator` | `Address` | Campaign creator |
| `token` | `Address` | First accepted token |
| `target_amount` | `i128` | Funding target |
| `deadline` | `u64` | Campaign deadline |
| `metadata` | `String` | Campaign metadata |

**Emitted by:** `create_campaign`

---

### `CampaignPledged`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Pledge"` |

**Data** (`CampaignPledged`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `contributor` | `Address` | Contributor address |
| `token` | `Address` | Token contributed |
| `amount` | `i128` | Contribution amount |

**Emitted by:** `contribute`

---

### `CampaignClaimed`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Claim"` |

**Data** (`CampaignClaimed`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `creator` | `Address` | Creator who claimed |
| `token` | `Address` | Token claimed |
| `amount` | `i128` | Amount claimed |

**Emitted by:** `claim` (one per token with balance)

---

### `CampaignRefunded`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Refund"` |

**Data** (`CampaignRefunded`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `contributor` | `Address` | Contributor refunded |
| `token` | `Address` | Token refunded |
| `amount` | `i128` | Amount refunded |

**Emitted by:** `refund`, `refund_all`

---

### `CampaignCanceled`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Cancel"` |

**Data** (`CampaignCanceled`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `creator` | `Address` | Creator who canceled |

**Emitted by:** `cancel_campaign`

---

### `ContractPaused`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Pause"` |

**Data** (`ContractPaused`):

| Field | Type | Description |
|-------|------|-------------|
| `contract_version` | `String` | Contract version at time of pause |

**Emitted by:** `set_paused(paused: true)`

---

### `ContractUnpaused`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Unpause"` |

**Data** (`ContractUnpaused`):

| Field | Type | Description |
|-------|------|-------------|
| `contract_version` | `String` | Contract version at time of unpause |

**Emitted by:** `set_paused(paused: false)`

---

### `MetadataUpdated`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"MetaUpd"` |

**Data** (`MetadataUpdated`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `creator` | `Address` | Creator who updated |
| `old_metadata` | `String` | Previous metadata value |
| `new_metadata` | `String` | New metadata value |

**Emitted by:** `update_metadata`

---

### `ExtensionRequested`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"ExtReq"` |

**Data** (`ExtensionRequested`):

| Field | Type | Description |
|-------|------|-------------|
| `campaign_id` | `u64` | Campaign ID |
| `requested_by` | `Address` | Contributor who requested |
| `new_deadline` | `u64` | Proposed new deadline |

**Emitted by:** `request_deadline_extension`

---

### `Migrated`

| Topic | Type | Value |
|-------|------|-------|
| 0 | `symbol` | `"Goal"` |
| 1 | `symbol` | `"Migrated"` |

**Data**: `(Address, u64, u64)` — tuple of `(old_contract_id, source_campaign_id, new_campaign_id)`

**Emitted by:** `migrate`

---

## Error Codes Reference

| Panic Message | Functions | Severity | Recovery |
|---------------|-----------|----------|----------|
| `"already initialized"` | `initialize` | High | Do not call `initialize()` again |
| `"min_contribution must be positive"` | `initialize` | High | Pass `min_contribution > 0` |
| `"not initialized"` | `set_paused`, `get_admin`, `migrate` | High | Call `initialize()` with admin address |
| `"caller is not admin"` | `set_paused` | Critical | Only the stored admin address can pause |
| `"only admin can call migrate"` | `migrate` | Critical | Only the stored admin address can migrate |
| `"contract is paused"` | all state-mutating functions | Medium | Wait for admin to unpause |
| `"campaign not found"` | all campaign-specific functions | High | Verify `campaign_id` via `get_campaign()` |
| `"target amount must be positive"` | `create_campaign` | High | Set `target_amount > 0` |
| `"deadline must be in the future"` | `create_campaign` | Medium | Set `deadline > env.ledger().timestamp()` |
| `"deadline exceeds maximum campaign duration"` | `create_campaign`, `request_deadline_extension` | Medium | Deadline must be within 180 days of creation |
| `"accepted_tokens must not be empty"` | `create_campaign` | High | Provide at least one token address |
| `"duplicate token addresses"` | `create_campaign` | Medium | Remove duplicate entries |
| `"too many accepted tokens"` | `create_campaign` | Medium | Max 10 tokens per campaign |
| `"max_per_contributor must not be negative"` | `create_campaign` | Low | Use 0 for no cap or a positive value |
| `"contribution below minimum"` | `contribute` | Medium | Increase to `get_min_contribution()` or higher |
| `"campaign already claimed"` | `contribute`, `claim`, `refund`, `refund_all`, `cancel_campaign`, `update_metadata`, `request_deadline_extension`, `approve_extension` | Medium | Campaign ended; check claim/refund options |
| `"campaign canceled"` | `contribute`, `claim`, `refund`, `update_metadata`, `request_deadline_extension`, `approve_extension` | Medium | Use `refund()` if you contributed |
| `"already canceled"` | `cancel_campaign` | Low | Campaign is already canceled |
| `"campaign deadline reached"` | `contribute`, `update_metadata` | Medium | Campaign ended; check claim/refund |
| `"campaign funding cap exceeded"` | `contribute` | Medium | Campaign reached its target; try another |
| `"token not accepted by this campaign"` | `contribute` | Medium | Use one of `campaign.accepted_tokens` |
| `"campaign is still active"` | `claim`, `refund`, `refund_all` | Medium | Wait for deadline or cancel first |
| `"campaign is not funded"` | `claim` | Medium | `pledged_amount < target_amount` |
| `"funded campaigns cannot be refunded"` | `refund`, `refund_all` | Medium | Campaign met its target; creator can claim |
| `"creator mismatch"` | `cancel_campaign`, `claim`, `update_metadata` | Critical | Only the campaign's `creator` address can perform this action |
| `"nothing to refund"` | `refund`, `refund_all` | Low | No contributions found for this contributor/campaign |
| `"caller is not a contributor"` | `request_deadline_extension`, `approve_extension` | Medium | Contribute to the campaign first |
| `"new deadline must be after current deadline"` | `request_deadline_extension` | Low | Choose a later timestamp |
| `"new deadline exceeds maximum campaign duration"` | `request_deadline_extension` | Low | Limit extension to within 180 days of creation |
| `"no extension request"` | `approve_extension` | Low | Call `request_deadline_extension()` first |
| `"already voted"` | `approve_extension` | Low | Each contributor votes once per request |
| `"source_ids and campaigns must have the same length"` | `migrate` | High | Ensure both vectors have equal length |

---

## Gas Estimates

All estimates are in Soroban **CPU instruction units**. Estimates include **20% headroom** as required by the deployment policy.

| Function | Base Estimate | With 20% Headroom | Notes |
|----------|--------------|-------------------|-------|
| `initialize` | 20,000 | **24,000** | One-time setup |
| `set_paused` | 16,000 | **19,200** | Includes event emission |
| `create_campaign` | 45,000 | **54,000** | +3,000 per accepted token |
| `cancel_campaign` | 18,000 | **21,600** | Single storage write + event |
| `update_metadata` | 22,000 | **26,400** | Storage + event |
| `contribute` | 50,000 | **60,000** | Token transfer + 2–3 storage writes |
| `claim` | 20,000 + 15,000/token | **42,000** (1 token) | Token transfer per accepted token |
| `refund` | 22,000 + 12,000/token | **40,800** (1 token) | Token transfer per contributor token |
| `refund_all` | 15,000 + 25,000/contributor | **348,000** (10 contributors) | Highly variable |
| `request_deadline_extension` | 26,000 | **31,200** | Storage writes + event |
| `approve_extension` | 30,000 | **36,000** | Conditional deadline update |
| `migrate` | 12,000 + 8,000/campaign | **105,600** (10 campaigns) | Per-campaign storage |
| `get_campaign` | 5,000 | **6,000** | Read-only |
| `get_contribution` | 5,000 | **6,000** | Read-only |
| `get_campaign_token_balance` | 4,500 | **5,400** | Read-only |
| `get_contributor_count` | 5,000 | **6,000** | Read-only |
| `get_min_contribution` | 4,000 | **4,800** | Read-only |
| `get_paused` | 3,000 | **3,600** | Read-only |
| `get_admin` | 4,000 | **4,800** | Read-only |
| `get_next_campaign_id` | 4,000 | **4,800** | Read-only |
| `get_campaign_count` | 4,000 | **4,800** | Read-only |
| `get_version` | 5,000 | **6,000** | Conditional first-call storage write |
| `get_deploy_info` | 7,000 | **8,400** | Conditional first-call storage write |
| `get_extension_request` | 5,000 | **6,000** | Read-only |

---

## Worked Examples

### Example 1: Full Campaign Lifecycle

Deploy and initialize the contract, create a campaign, contribute, wait for deadline, and claim.

```typescript
// --- Setup ---
// 1. Initialize contract (admin = GABC..., min_contribution = 100 stroops)
//    This is called once when the contract is first deployed.
//    Cost: ~24,000 gas units
//    Storage: sets Admin, Paused=false, MinContribution=100

// 2. Create campaign
//    creator = GBCD..., target = 10_000 stroops, deadline = now + 7 days
//    accepted_tokens = [USDC_token_address], metadata = "Help build a school"
//    Returns: campaign_id = 1
//    Cost: ~54,000 gas units
//    Storage: Campaign(1), NextCampaignId=1, ContributorCap(1) not stored (0 = no cap)
//    Event: CampaignCreated { campaign_id: 1, creator: GBCD..., ... }

// --- Contributing ---
// 3. Contributor GEFG... contributes 500 USDC
//    contribute(campaign_id=1, contributor=GEFG..., token=USDC, amount=500)
//    Cost: ~60,000 gas units
//    Effects:
//      - TokenClient.transfer(GEFG..., contract_address, 500)
//      - Campaign(1).pledged_amount: 0 → 500
//      - Campaign(1).contributor_count: 0 → 1
//      - HasContributed(1, GEFG...) = true
//      - CampaignTokenBalance(1, USDC) = 500
//    Event: CampaignPledged { campaign_id: 1, contributor: GEFG..., ... }

// --- Waiting ---
// 4. Wait until deadline passes (env.ledger().timestamp() > campaign.deadline)

// --- Claiming ---
// 5. Creator claims funds
//    claim(campaign_id=1, creator=GBCD...)
//    Cost: ~42,000 gas units (1 token)
//    Effects:
//      - Campaign(1).claimed = true
//      - TokenClient.transfer(contract_address, GBCD..., 500)
//      - CampaignTokenBalance(1, USDC) = 0
//    Event: CampaignClaimed { campaign_id: 1, creator: GBCD..., ... }
```

### Example 2: Cancel + Refund

Create a campaign, contribute, cancel before deadline, and refund.

```typescript
// --- Setup ---
// initialize(admin=GABC..., min_contribution=100)
// create_campaign(creator=GBCD..., target=10_000, deadline=now+30d, ...)
//   → campaign_id = 1

// --- Contribute ---
// contribute(campaign_id=1, contributor=GEFG..., token=USDC, amount=500)
//   → Campaign(1).pledged_amount = 500, contributor_count = 1

// --- Cancel ---
// cancel_campaign(campaign_id=1, creator=GBCD...)
//   → Campaign(1).canceled = true
//   Event: CampaignCanceled { campaign_id: 1, creator: GBCD... }

// --- Refund (individual) ---
// refund(campaign_id=1, contributor=GEFG...)
//   → Tokens transferred back to GEFG...
//   → Campaign(1).pledged_amount = 0
//   Event: CampaignRefunded { campaign_id: 1, contributor: GEFG..., ... }
```

### Example 3: Deadline Extension Governance

Multiple contributors vote to extend a campaign deadline.

```typescript
// --- Setup ---
// create_campaign(creator=GBCD..., target=10_000, deadline=now+14d, ...)
//   → campaign_id = 1

// Contributors GEFG... and GHIF... each contribute
// contribute(campaign_id=1, contributor=GEFG..., token=USDC, amount=5_000)
// contribute(campaign_id=1, contributor=GHIF..., token=USDC, amount=3_000)
//   → contributor_count = 2

// --- Extension Request ---
//   contributor_count = 2, need >50% → need 2 approvals
// request_deadline_extension(campaign_id=1, caller=GEFG..., new_deadline=now+21d)
//   → ExtensionRequest(1) = { new_deadline: now+21d, requested_by: GEFG..., approval_count: 1 }
//   Event: ExtensionRequested { campaign_id: 1, requested_by: GEFG..., new_deadline: now+21d }

// --- Approval (majority reached) ---
// approve_extension(campaign_id=1, caller=GHIF...)
//   → approval_count: 1 → 2
//   → 2 * 2 > 2 = true → deadline applied
//   → Campaign(1).deadline = now+21d
//   → ExtensionRequest(1) cleared
//   No new event (the extension application is implicit in approve_extension)
```

### Example 4: Multi-Token Campaign

Campaign accepts multiple token types.

```typescript
// --- Create multi-token campaign ---
// accepted_tokens = [USDC, EURC, BRL]
// create_campaign(creator=GBCD..., accepted_tokens=[USDC, EURC, BRL], target=15_000, ...)
//   → campaign_id = 1

// --- Contribute with different tokens ---
// contribute(campaign_id=1, contributor=GEFG..., token=USDC, amount=5_000)
//   → CampaignTokenBalance(1, USDC) = 5_000
//   → pledged_amount = 5_000

// contribute(campaign_id=1, contributor=GEFG..., token=EURC, amount=3_000)
//   → CampaignTokenBalance(1, EURC) = 3_000
//   → pledged_amount = 8_000 (contributor_count stays 1, same contributor)

// contribute(campaign_id=1, contributor=GHIF..., token=BRL, amount=7_000)
//   → CampaignTokenBalance(1, BRL) = 7_000
//   → pledged_amount = 15_000 (reached target)
//   → contributor_count = 2

// --- Claim ---
// claim(campaign_id=1, creator=GBCD...)
//   → Transfers USDC(5k) + EURC(3k) + BRL(7k) to creator
//   → 3 CampaignClaimed events emitted (one per token)
```

### Example 5: Read-Only Queries

Checking campaign state without mutation.

```typescript
// --- Check campaign state ---
// get_campaign(campaign_id=1)
//   → Returns full Campaign struct:
//     { creator, accepted_tokens, target_amount: 10_000,
//       pledged_amount: 5_000, deadline: ..., claimed: false,
//       canceled: false, metadata: "Help build a school",
//       contributor_count: 1, created_at: ... }

// --- Check specific contribution ---
// get_contribution(campaign_id=1, contributor=GEFG..., token=USDC)
//   → Returns 5_000

// --- Check admin ---
// get_admin() → GABC...

// --- Check version ---
// get_version() → "0.1.0"

// --- Check extension status ---
// get_extension_request(campaign_id=1)
//   → Returns Option<ExtensionRequest>
//     None if no pending request, Some(request) if one exists
```

---

*Last updated: 2026-07-29*
