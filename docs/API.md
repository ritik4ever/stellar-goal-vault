# Stellar Goal Vault — API Reference

Full reference for the Stellar Goal Vault REST API.

- **Local backend base URL:** `http://localhost:3001`
- **Frontend proxy base URL:** `/api`
- **Machine-readable spec:** `GET /api/docs` (OpenAPI 3.1 JSON)
- **Interactive explorer:** `GET /api/docs/ui/` (Swagger UI)

---

## Table of Contents

- [Health](#health)
  - [GET /api/health](#get-apihealth)
  - [GET /api/health/deep](#get-apihealthdeep)
- [Campaigns](#campaigns)
  - [GET /api/campaigns](#get-apicampaigns)
  - [POST /api/campaigns](#post-apicampaigns)
  - [GET /api/campaigns/:id](#get-apicampaignsid)
  - [GET /api/campaigns/:id/pledges](#get-apicampaignsidpledges)
  - [POST /api/campaigns/:id/pledges](#post-apicampaignsidpledges)
  - [POST /api/campaigns/:id/pledges/reconcile](#post-apicampaignsidpledgesreconcile)
  - [POST /api/campaigns/:id/claim](#post-apicampaignsidclaim)
  - [POST /api/campaigns/:id/refund](#post-apicampaignsidrefund)
  - [GET /api/campaigns/:id/history](#get-apicampaignsidhistory)
  - [GET /api/campaigns/:id/contributors](#get-apicampaignsidcontributors)
- [Misc](#misc)
  - [GET /api/stats](#get-apistats)
  - [GET /api/config](#get-apiconfig)
  - [GET /api/leaderboard](#get-apileaderboard)
  - [GET /api/open-issues](#get-apiopen-issues)
- [Docs](#docs)
  - [GET /api/docs](#get-apidocs)
  - [GET /api/docs/ui/](#get-apidocsui)

---

## Health

### `GET /api/health`

Basic liveness check. Returns service status and a lightweight database reachability probe.

**Response `200 OK`:**

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2026-03-27T21:30:00.000Z",
  "uptimeSeconds": 12.345,
  "database": {
    "status": "up",
    "reachable": true
  }
}
```

- `status` is `"ok"` when both the API and the database probe succeed, `"degraded"` otherwise.
- `database.status` is `"up"` or `"down"` based on a lightweight SQLite reachability check.
- Returns `503` when the service is degraded.

---

### `GET /api/health/deep`

Extended health check that probes the database, Soroban RPC, and the configured contract.

**Response `200 OK`:**

```json
{
  "overall": "up",
  "timestamp": "2026-03-27T21:30:00.000Z",
  "uptimeSeconds": 12.345,
  "components": {
    "db": { "status": "up", "details": "reachable" },
    "soroban": { "status": "up", "details": "rpc reachable" },
    "contract": { "status": "up", "details": "contract id configured" }
  }
}
```

Returns `503` when `overall` is `"down"`.

---

## Campaigns

### `GET /api/campaigns`

Returns all campaigns with computed progress. Supports filtering, sorting, and pagination.

**Query parameters:**

| Parameter      | Type     | Description                                                             |
|----------------|----------|-------------------------------------------------------------------------|
| `q`            | string   | Search query — filters by title, creator address, or campaign ID.       |
| `asset`        | string   | Comma-separated asset codes to filter by (e.g. `USDC,XLM`).            |
| `status`       | string   | Filter by campaign status: `open`, `funded`, `claimed`, or `failed`.    |
| `sort`         | string   | Sort field: `createdAt`, `deadline`, `pledgedAmount`, `targetAmount`.   |
| `order`        | string   | Sort direction: `asc` or `desc`.                                        |
| `page`         | integer  | Page number (requires `limit`).                                         |
| `limit`        | integer  | Results per page 1–100 (requires `page`).                               |
| `createdAfter` | ISO 8601 | Return campaigns created after this timestamp.                          |
| `createdBefore`| ISO 8601 | Return campaigns created before this timestamp.                         |

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "1",
      "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "title": "Clean Water Initiative",
      "description": "Raising funds to provide clean water access.",
      "acceptedTokens": ["USDC"],
      "assetCode": "USDC",
      "targetAmount": 1000,
      "pledgedAmount": 455,
      "deadline": 1780000000,
      "createdAt": 1779000000,
      "tokenBalances": { "USDC": 455 },
      "progress": {
        "status": "open",
        "percentFunded": 45.5,
        "remainingAmount": 545,
        "pledgeCount": 12,
        "hoursLeft": 72,
        "canPledge": true,
        "canClaim": false,
        "canRefund": false
      }
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### `POST /api/campaigns`

Creates a new campaign.

**Request body:**

```json
{
  "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "title": "Clean Water Initiative",
  "description": "Raising funds to provide clean water access.",
  "assetCode": "USDC",
  "targetAmount": 1000,
  "deadline": 1780000000,
  "maxPerContributor": 500
}
```

| Field                | Type    | Required | Description                                              |
|----------------------|---------|----------|----------------------------------------------------------|
| `creator`            | string  | yes      | Stellar public key of the campaign creator.              |
| `title`              | string  | yes      | Campaign title.                                          |
| `description`        | string  | yes      | Campaign description (minimum 20 characters).            |
| `assetCode`          | string  | yes      | Accepted Stellar asset code (e.g. `USDC`, `XLM`).        |
| `targetAmount`       | number  | yes      | Funding target (positive).                               |
| `deadline`           | integer | yes      | Unix timestamp (seconds) for the campaign deadline.      |
| `maxPerContributor`  | integer | no       | Maximum total pledge per contributor. No limit if unset. |

**Response `201 Created`:** The created campaign object wrapped in `{ "data": { ... } }`.

---

### `GET /api/campaigns/:id`

Returns a single campaign with pledges and event history.

**Path parameters:** `id` — numeric campaign ID.

**Response `200 OK`:** Campaign object with embedded `pledges` array, wrapped in `{ "data": { ... } }`.

**Response `404 Not Found`** when the campaign does not exist.

---

### `GET /api/campaigns/:id/pledges`

Returns paginated pledges for a campaign.

**Query parameters:**

| Parameter | Type    | Description              |
|-----------|---------|--------------------------|
| `page`    | integer | Page number (default 1). |
| `limit`   | integer | Results per page 1–100.  |

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": 1,
      "campaignId": "1",
      "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "amount": 50,
      "assetCode": "USDC",
      "createdAt": 1779500000,
      "transactionHash": null
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### `POST /api/campaigns/:id/pledges`

Adds a pledge to an open campaign.

**Request body:**

```json
{
  "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "amount": 50
}
```

**Response `201 Created`:** Updated campaign object wrapped in `{ "data": { ... } }`.

**Response `400`** when the campaign is not open, the amount is invalid, or a per-contributor limit is exceeded.

**Response `404`** when the campaign does not exist.

---

### `POST /api/campaigns/:id/pledges/reconcile`

Records a confirmed on-chain pledge locally after the Soroban transaction succeeds.

**Request body:**

```json
{
  "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "amount": 50,
  "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "confirmedAt": 1779500000
}
```

**Response `201 Created`:** `{ "data": { "campaign": { ... }, "transactionHash": "..." } }`

---

### `POST /api/campaigns/:id/claim`

Claims funds for a successfully funded campaign after the deadline.

**Request body:**

```json
{
  "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```

**Response `200 OK`:** Updated campaign object (status becomes `"claimed"`).

**Response `400`** when the campaign is not in a claimable state.

---

### `POST /api/campaigns/:id/refund`

Refunds all active pledges from one contributor on a failed campaign.

**Request body:**

```json
{
  "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
}
```

**Response `200 OK`:** `{ "data": { ...campaign, "refundedAmount": 50 } }`

**Response `400`** when the campaign has not failed.

---

### `GET /api/campaigns/:id/history`

Returns the local event history for a campaign (created, pledged, claimed, refunded, etc.).

**Query parameters:**

| Parameter  | Type    | Description              |
|------------|---------|--------------------------|
| `page`     | integer | Page number (default 1). |
| `pageSize` | integer | Results per page 1–100.  |

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": 1,
      "campaignId": "1",
      "eventType": "pledged",
      "timestamp": 1779500000,
      "actor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "amount": 50,
      "metadata": {}
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "hasMore": false
}
```

---

### `GET /api/campaigns/:id/contributors`

Returns a contributor summary (grouped pledges with refund status) for a campaign.

**Response `200 OK`:**

```json
{
  "data": [
    {
      "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "totalPledged": 150.0,
      "refundedAmount": 0,
      "isFullyRefunded": false
    }
  ]
}
```

Empty campaigns return `{ "data": [] }`. Invalid IDs return `404`.

---

## Misc

### `GET /api/stats`

Returns aggregate metrics computed from all campaigns and pledges. Cached with a 30-second TTL.

**Response `200 OK`:**

```json
{
  "data": {
    "totalCampaigns": 10,
    "openCampaigns": 5,
    "fundedCampaigns": 3,
    "claimedCampaigns": 1,
    "failedCampaigns": 1,
    "totalPledgeVolume": 50000,
    "uniqueContributors": 42
  }
}
```

---

### `GET /api/config`

Returns the runtime configuration exposed to the frontend (allowed assets, Soroban network settings, contract ID).

**Response `200 OK`:**

```json
{
  "data": {
    "allowedAssets": ["USDC", "XLM"],
    "soroban": {
      "enabled": true,
      "contractId": "C...",
      "networkPassphrase": "Test SDF Network ; September 2015",
      "rpcUrl": "https://soroban-testnet.stellar.org"
    },
    "contractAmountDecimals": 2,
    "walletIntegrationReady": true,
    "assetAddresses": {}
  }
}
```

---

### `GET /api/leaderboard`

Returns the top contributors by total pledged amount.

**Query parameters:**

| Parameter | Type    | Description                                     |
|-----------|---------|-------------------------------------------------|
| `limit`   | integer | Number of top contributors to return (1–100).   |

**Response `200 OK`:**

```json
{
  "data": [
    {
      "rank": 1,
      "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "totalPledged": 1500,
      "campaignCount": 3,
      "averagePledgeAmount": 500
    }
  ]
}
```

---

### `GET /api/open-issues`

Returns the list of seeded open-source contribution ideas for this project. This endpoint powers the
**Contribution Backlog** panel in the frontend dashboard and is intended to help new contributors
discover actionable tasks.

The list is statically seeded in [`backend/src/services/openIssues.ts`](../backend/src/services/openIssues.ts).
There are no query parameters; the full list is always returned.

**Response `200 OK`:**

```json
{
  "data": [
    {
      "id": "SGV-1",
      "title": "Implement Freighter-signed pledge transactions",
      "labels": ["enhancement", "help wanted", "soroban"],
      "summary": "Replace mock API pledges with wallet-signed Soroban transactions, then surface transaction hashes and simulation errors in the UI timeline.",
      "complexity": "High",
      "points": 200
    },
    {
      "id": "SGV-2",
      "title": "Sync campaign status from Soroban events",
      "labels": ["backend", "indexer", "good first issue"],
      "summary": "Add an RPC event indexer that backfills pledge, claim, and refund events so local SQLite stays aligned with on-chain campaign activity.",
      "complexity": "Medium",
      "points": 150
    },
    {
      "id": "SGV-3",
      "title": "Add campaign filtering and sort presets",
      "labels": ["frontend", "ux", "good first issue"],
      "summary": "Support filtering by asset and status, plus quick sorts for nearing-deadline and most-funded campaigns to improve the contributor dashboard.",
      "complexity": "Trivial",
      "points": 100
    }
  ]
}
```

**Response schema — each item:**

| Field        | Type                           | Description                                                 |
|--------------|--------------------------------|-------------------------------------------------------------|
| `id`         | string                         | Unique issue identifier (e.g. `SGV-1`).                     |
| `title`      | string                         | Short issue title.                                          |
| `labels`     | string[]                       | GitHub-style label tags.                                    |
| `summary`    | string                         | One or two sentence description of the work.                |
| `complexity` | `"Trivial"` \| `"Medium"` \| `"High"` | Estimated implementation effort.                   |
| `points`     | `100` \| `150` \| `200`        | Reward points: 100 (Trivial), 150 (Medium), 200 (High).     |

> **Adding new issues:** See [`backend/src/services/openIssues.ts`](../backend/src/services/openIssues.ts)
> and the [Contributing Guide](../CONTRIBUTING.md#adding-new-open-issues) for instructions.

---

## Docs

### `GET /api/docs`

Returns the machine-readable OpenAPI 3.1 JSON specification for this API.

### `GET /api/docs/ui/`

Serves the Swagger UI interactive explorer. Open in a browser to browse and try all endpoints.
