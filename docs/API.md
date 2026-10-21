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
  - [GET /api/campaigns/:id/analytics](#get-apicampaignsidanalytics)
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
  },
  "indexer": {
    "lastSuccessfulPollTime": 1779500000000,
    "lastKnownLedger": 123456,
    "isHealthy": true,
    "consecutiveFailures": 0,
    "lagMs": 1500
  }
}
```

- `status` is `"ok"` when both the API and the database probe succeed, `"degraded"` otherwise.
- `database.status` is `"up"` or `"down"` based on a lightweight SQLite reachability check.
- `indexer` exposes the last successful update and freshness/lag for the background event indexer.
- Returns `503` when the service is degraded.
- Unexpected failures return the standard error envelope `{ "success": false, "error": { "code": string, "message": string, "requestId": string } }` (status `500`) while logging internal details securely.

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
    "contract": { "status": "up", "details": "contract id configured" },
    "indexer": {
      "status": "up",
      "details": {
        "lastSuccessfulPollTime": 1779500000000,
        "lastKnownLedger": 123456,
        "isHealthy": true,
        "consecutiveFailures": 0,
        "lagMs": 1500
      }
    }
  }
}
```

Returns `503` when `overall` is `"down"`. Unexpected failures return the standard error envelope `{ "success": false, "error": { "code": string, "message": string, "requestId": string } }` (status `500`) while logging structured context securely without exposing sensitive internals.

---

## Campaigns

### `GET /api/campaigns`

Returns all campaigns with computed progress. Supports filtering, sorting, and pagination.

**Query parameters:**

Omit both `page` and `limit` to preserve the existing behavior and return the full filtered
campaign list. To page through results, provide both parameters; `limit` is bounded from 1 to 100.
Invalid values, or providing only one of the pair, return `400 Bad Request`.

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

> **Pagination stability:** results are ordered by the requested `sort` field and then by
> `id` in the same `order` direction. That tie-breaker makes consecutive `page` requests
> form stable, non-overlapping chunks even when many campaigns share the same sort value,
> so loading later chunks never repeats or skips a campaign.

The `pagination` object includes `total`, `page`, `limit`, and `totalPages`, plus
`hasPreviousPage` and `hasNextPage` so clients can enable navigation controls directly.

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
    "totalPages": 1,
    "hasPreviousPage": false,
    "hasNextPage": false
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

Returns a single campaign with computed `progress` and a bounded preview of its five newest
pledges. Full pledge history and pagination live on the dedicated collection endpoints below.

**Path parameters:** `id` — canonical positive integer campaign ID. Values such as `0`,
`-1`, `1.5`, `01`, or non-numeric strings are rejected with `400` and a `details` entry for
the `id` field rather than being coerced.

**Response `200 OK`:** Campaign object with `progress` and a `pledges` preview, wrapped in
`{ "data": { ... }, "requestId": "..." }`. The `requestId` correlation ID matches the `X-Request-Id` response
header and can be correlated across structured backend logs. Responses are cached per campaign for 30 seconds (`X-Cache`
reports `MISS` for a fresh read and `HIT` for a cached one; cached payloads are shared while correlation IDs remain unique per request).

**Response `400 Bad Request`** for a malformed ID, **`404 Not Found`** when the campaign does
not exist, and **`500`** with a generic error body (no storage or stack details) when the
underlying read fails. Known error paths return the standard error envelope `{ "success": false, "error": { "code": string, "message": string, "requestId": string, "details"?: array } }` while unexpected failures log structured context without leaking internals.

---

### `GET /api/campaigns/:id/analytics`

Read-only analytics for one campaign.

**Path parameters:** `id` — canonical positive integer campaign ID (validated the same way as
the detail endpoint).

**Query parameters:** none. Unknown parameters such as `?page=2` are rejected with `400`
(`details[].field = "query"`) instead of being silently ignored.

**Response `200 OK`:**

```json
{
  "data": {
    "campaignId": "1",
    "fundingGap": 775,
    "status": "open",
    "percentFunded": 22.5,
    "pledgeCount": 3,
    "contributorCount": 2
  }
}
```

`fundingGap` is clamped at zero for over-funded campaigns, `pledgeCount` counts active
(non-refunded) pledges, and `contributorCount` counts distinct contributors who still have
funds in the campaign (fully refunded contributors are excluded).

**Response `400 Bad Request`** for a malformed ID or unsupported query parameter, and
**`404 Not Found`** when the campaign does not exist.

---

### `GET /api/campaigns/:id/pledges`

Returns paginated pledges for a campaign, newest first.

**Query parameters:**

| Parameter | Type    | Description                                              |
|-----------|---------|----------------------------------------------------------|
| `page`    | integer | Page number, 1-based (default 1).                        |
| `limit`   | integer | Results per page, 1–100 (default 10).                    |

Pagination is deterministic (`created_at DESC, id DESC`). Out-of-range values — `page=0`,
`page=abc`, `limit=101`, `limit=1.5` — return `400` with a `VALIDATION_ERROR` envelope rather
than being clamped, and a page past the end returns an empty `data` array with the real
`total`/`totalPages`.

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
    "total": 3,
    "page": 1,
    "limit": 2,
    "totalPages": 2,
    "hasPreviousPage": false,
    "hasNextPage": true
  }
}
```

The same `pagination` shape (including `hasPreviousPage`/`hasNextPage`) is returned by
`GET /api/contributors/:address/pledges`.

---

### `POST /api/campaigns/:id/pledges`

Adds a pledge to an open campaign.

**Path parameters:** `id` — canonical positive integer campaign ID. Malformed IDs (such as
`0`, `-1`, `1.5`, `01`, or non-numeric strings) return `400` with a `VALIDATION_ERROR`
envelope containing a field-level detail for `id`.

**Request body:**

```json
{
  "contributor": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "amount": 50,
  "assetCode": "USDC"
}
```

**Response `201 Created`:** Updated campaign object with computed `progress`, wrapped in `{ "data": { ... } }`.

**Response `400 Bad Request`** for malformed path IDs, payload validation failures, closed or expired
campaigns (`INVALID_CAMPAIGN_STATE`), per-contributor limit breaches (`MAX_PER_CONTRIBUTOR_EXCEEDED`),
funding cap breaches (`CAMPAIGN_FUNDING_CAP_EXCEEDED`), or unsupported tokens (`INVALID_ASSET`).

**Response `404 Not Found`** when the campaign does not exist.

**Response `500 Internal Server Error`** with a generic error envelope (no storage or stack details) when a
server-side failure occurs.

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
