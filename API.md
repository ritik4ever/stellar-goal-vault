# Stellar Goal Vault API Reference

Comprehensive API documentation for the Stellar Goal Vault backend.

## Base URL

- **Local Development**: `http://localhost:3000`
- **Production**: Configured via `CORS_ALLOWED_ORIGINS`

## Authentication

**Current Status**: Public API (no authentication required)

**Future**: API key authentication will be required in production. Configure via `API_KEY` environment variable.

## Rate Limiting

The API implements rate limiting to ensure fair usage:

- **Read Operations** (GET): 120 requests per minute (configurable via `RATE_LIMIT_READ_LIMIT`)
- **Write Operations** (POST/PUT/PATCH/DELETE): 20 requests per minute (configurable via `RATE_LIMIT_WRITE_LIMIT`)

### Rate Limit Headers

All responses include rate limit information:

- `X-RateLimit-Limit`: Maximum requests allowed in the window
- `X-RateLimit-Remaining`: Remaining requests in the current window
- `X-RateLimit-Reset`: Unix timestamp when the window resets
- `Retry-After`: Seconds to wait before retrying (only when rate limited)

### Rate Limit Error

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Please retry shortly.",
    "requestId": "req-123"
  }
}
```

**Recovery**: Wait for the duration specified in `Retry-After` header before retrying.

## Pagination

### Campaign List Pagination

Query parameters:
- `page`: Page number (1-based, requires `limit`)
- `limit`: Items per page (1-100, requires `page`)

**Note**: Both `page` and `limit` must be provided together. Omit both to return all results.

### Pledge List Pagination

Query parameters:
- `page`: Page number (1-based, default: 1)
- `limit`: Items per page (1-100, default: 10)

### History Pagination

Query parameters:
- `page`: Page number (1-based, default: 1)
- `pageSize`: Items per page (1-100, default: 20)

### Pagination Response

All paginated endpoints return:

```json
{
  "data": [...],
  "pagination": {
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

## Error Codes

| Code | HTTP Status | Description | Recovery Action |
|------|-------------|-------------|-----------------|
| `VALIDATION_ERROR` | 400 | Request validation failed | Fix the validation errors in `error.details` |
| `NOT_FOUND` | 404 | Resource not found | Verify the resource ID exists |
| `INVALID_DEADLINE` | 400 | Deadline must be in the future | Provide a future Unix timestamp |
| `INVALID_SORT_FIELD` | 400 | Invalid sort field | Use valid sort field: `createdAt`, `deadline`, `pledgedAmount`, `targetAmount` |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Wait for `Retry-After` seconds |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds limit | Reduce payload size (max: 16KB) |
| `FORBIDDEN` | 403 | CORS policy violation | Ensure origin is in `CORS_ALLOWED_ORIGINS` |
| `SERVICE_UNAVAILABLE` | 503 | Server is shutting down | Retry after a few seconds |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error | Contact support with `requestId` |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "creator: Must be a valid Stellar account ID (starts with G and is exactly 56 characters).",
    "details": [
      {
        "field": "creator",
        "message": "Must be a valid Stellar account ID (starts with G and is exactly 56 characters)."
      }
    ],
    "requestId": "req-123"
  }
}
```

---

## Endpoints

### Health

#### GET /api/health

Basic health check endpoint.

**Response** (200 OK):
```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptimeSeconds": 3600.123,
  "database": {
    "reachable": true,
    "error": null
  }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/health
```

---

#### GET /api/health/deep

Deep health check that verifies database, Soroban RPC, and contract configuration.

**Response** (200 OK):
```json
{
  "overall": "up",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptimeSeconds": 3600.123,
  "components": {
    "db": {
      "status": "up",
      "details": "SQLite database reachable"
    },
    "soroban": {
      "status": "up",
      "details": "Soroban RPC reachable"
    },
    "contract": {
      "status": "up",
      "details": "CONTRACT_ID configured"
    }
  }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/health/deep
```

---

### Campaigns

#### GET /api/campaigns

List campaigns with optional filtering, sorting, and pagination.

**Query Parameters**:
- `page`: Page number (requires `limit`)
- `limit`: Items per page 1-100 (requires `page`)
- `q` or `search`: Search query (searches title, creator, or id)
- `asset`: Comma-separated list of asset codes (e.g., `USDC,XLM`)
- `status`: Filter by status (`open`, `funded`, `claimed`, `failed`)
- `sort`: Sort field (`createdAt`, `deadline`, `pledgedAmount`, `targetAmount`)
- `order`: Sort order (`asc`, `desc`)
- `includeDeleted`: Include deleted campaigns (`true` or `false`)
- `createdAfter`: ISO 8601 timestamp filter
- `createdBefore`: ISO 8601 timestamp filter

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "1",
      "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "title": "Clean Water Initiative",
      "description": "Raising funds to provide clean water access.",
      "acceptedTokens": ["USDC", "XLM"],
      "assetCode": "USDC",
      "targetAmount": 1000,
      "pledgedAmount": 455,
      "deadline": 1705334400,
      "createdAt": 1704729600,
      "claimedAt": null,
      "failedAt": null,
      "deletedAt": null,
      "metadata": {
        "imageUrl": "https://example.com/image.jpg",
        "externalLink": "https://example.com"
      },
      "maxPerContributor": 500,
      "tokenBalances": {
        "USDC": 455,
        "XLM": 0
      },
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
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

**cURL Examples**:
```bash
# List all campaigns
curl http://localhost:3000/api/campaigns

# List with pagination
curl "http://localhost:3000/api/campaigns?page=1&limit=10"

# Filter by status
curl "http://localhost:3000/api/campaigns?status=open"

# Search campaigns
curl "http://localhost:3000/api/campaigns?q=water"

# Sort by pledged amount (descending)
curl "http://localhost:3000/api/campaigns?sort=pledgedAmount&order=desc"

# Filter by asset
curl "http://localhost:3000/api/campaigns?asset=USDC"

# Combine filters
curl "http://localhost:3000/api/campaigns?status=open&asset=USDC&page=1&limit=20"
```

---

#### POST /api/campaigns

Create a new campaign.

**Request Body**:
```json
{
  "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "title": "Clean Water Initiative",
  "description": "Raising funds to provide clean water access.",
  "acceptedTokens": ["USDC", "XLM"],
  "targetAmount": 1000,
  "deadline": 1705334400,
  "metadata": {
    "imageUrl": "https://example.com/image.jpg",
    "externalLink": "https://example.com"
  },
  "maxPerContributor": 500
}
```

**Validation Rules**:
- `creator`: Valid Stellar public key (56 characters, starts with G)
- `title`: Non-empty string (max length enforced by DB)
- `description`: Non-empty string
- `acceptedTokens`: Array of supported asset codes (1-12 alphanumeric chars)
- `targetAmount`: Positive number
- `deadline`: Unix timestamp in the future
- `metadata.imageUrl`: HTTPS URL (optional)
- `metadata.externalLink`: HTTPS URL (optional)
- `maxPerContributor`: Positive integer (optional)

**Response** (201 Created):
```json
{
  "data": {
    "id": "1",
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC", "XLM"],
    "assetCode": "USDC",
    "targetAmount": 1000,
    "pledgedAmount": 0,
    "deadline": 1705334400,
    "createdAt": 1704729600,
    "claimedAt": null,
    "failedAt": null,
    "deletedAt": null,
    "metadata": {
      "imageUrl": "https://example.com/image.jpg",
      "externalLink": "https://example.com"
    },
    "maxPerContributor": 500,
    "tokenBalances": {
      "USDC": 0,
      "XLM": 0
    },
    "progress": {
      "status": "open",
      "percentFunded": 0,
      "remainingAmount": 1000,
      "pledgeCount": 0,
      "hoursLeft": 168,
      "canPledge": true,
      "canClaim": false,
      "canRefund": false
    }
  }
}
```

**cURL**:
```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC"],
    "targetAmount": 1000,
    "deadline": 1705334400
  }'
```

---

#### GET /api/campaigns/:id

Get detailed information about a specific campaign, including recent pledges.

**Response** (200 OK):
```json
{
  "data": {
    "id": "1",
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC", "XLM"],
    "assetCode": "USDC",
    "targetAmount": 1000,
    "pledgedAmount": 455,
    "deadline": 1705334400,
    "createdAt": 1704729600,
    "claimedAt": null,
    "failedAt": null,
    "deletedAt": null,
    "metadata": {
      "imageUrl": "https://example.com/image.jpg",
      "externalLink": "https://example.com"
    },
    "maxPerContributor": 500,
    "tokenBalances": {
      "USDC": 455,
      "XLM": 0
    },
    "progress": {
      "status": "open",
      "percentFunded": 45.5,
      "remainingAmount": 545,
      "pledgeCount": 12,
      "hoursLeft": 72,
      "canPledge": true,
      "canClaim": false,
      "canRefund": false
    },
    "pledges": [
      {
        "id": 1,
        "campaignId": "1",
        "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "amount": 50,
        "assetCode": "USDC",
        "createdAt": 1704729700,
        "refundedAt": null,
        "transactionHash": null
      }
    ]
  }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/campaigns/1
```

---

#### GET /api/campaigns/:id/pledges

List all pledges for a specific campaign with pagination.

**Query Parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page 1-100 (default: 10)

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 1,
      "campaignId": "1",
      "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "amount": 50,
      "assetCode": "USDC",
      "createdAt": 1704729700,
      "refundedAt": null,
      "transactionHash": null
    }
  ],
  "pagination": {
    "total": 12,
    "page": 1,
    "limit": 10,
    "totalPages": 2
  }
}
```

**cURL**:
```bash
curl "http://localhost:3000/api/campaigns/1/pledges?page=1&limit=10"
```

---

#### POST /api/campaigns/:id/pledges

Create a pledge for a campaign.

**Request Body**:
```json
{
  "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "amount": 50,
  "assetCode": "USDC"
}
```

**Validation Rules**:
- `contributor`: Valid Stellar public key
- `amount`: Positive number
- `assetCode`: Supported asset code

**Response** (201 Created):
```json
{
  "data": {
    "id": "1",
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC", "XLM"],
    "assetCode": "USDC",
    "targetAmount": 1000,
    "pledgedAmount": 50,
    "deadline": 1705334400,
    "createdAt": 1704729600,
    "claimedAt": null,
    "failedAt": null,
    "deletedAt": null,
    "metadata": null,
    "maxPerContributor": null,
    "tokenBalances": {
      "USDC": 50,
      "XLM": 0
    },
    "progress": {
      "status": "open",
      "percentFunded": 5,
      "remainingAmount": 950,
      "pledgeCount": 1,
      "hoursLeft": 168,
      "canPledge": true,
      "canClaim": false,
      "canRefund": false
    }
  }
}
```

**cURL**:
```bash
curl -X POST http://localhost:3000/api/campaigns/1/pledges \
  -H "Content-Type: application/json" \
  -d '{
    "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "amount": 50,
    "assetCode": "USDC"
  }'
```

---

#### POST /api/campaigns/:id/pledges/reconcile

Reconcile an on-chain pledge that was already executed. Records a pledge using its transaction hash.

**Request Body**:
```json
{
  "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "amount": 50,
  "assetCode": "USDC",
  "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "confirmedAt": 1704729800
}
```

**Validation Rules**:
- `contributor`: Valid Stellar public key
- `amount`: Positive number
- `assetCode`: Supported asset code
- `transactionHash`: 64-character hexadecimal hash
- `confirmedAt`: Unix timestamp (optional)

**Response** (201 Created):
```json
{
  "data": {
    "campaign": {
      "id": "1",
      "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "title": "Clean Water Initiative",
      "description": "Raising funds to provide clean water access.",
      "acceptedTokens": ["USDC"],
      "assetCode": "USDC",
      "targetAmount": 1000,
      "pledgedAmount": 50,
      "deadline": 1705334400,
      "createdAt": 1704729600,
      "claimedAt": null,
      "failedAt": null,
      "deletedAt": null,
      "metadata": null,
      "maxPerContributor": null,
      "tokenBalances": {
        "USDC": 50
      },
      "progress": {
        "status": "open",
        "percentFunded": 5,
        "remainingAmount": 950,
        "pledgeCount": 1,
        "hoursLeft": 168,
        "canPledge": true,
        "canClaim": false,
        "canRefund": false
      }
    },
    "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

**cURL**:
```bash
curl -X POST http://localhost:3000/api/campaigns/1/pledges/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "amount": 50,
    "assetCode": "USDC",
    "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

---

#### POST /api/campaigns/:id/claim

Claim funds for a successfully funded campaign after the deadline.

**Request Body**:
```json
{
  "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "confirmedAt": 1705334500
}
```

**Validation Rules**:
- `creator`: Valid Stellar public key (must match campaign creator)
- `transactionHash`: 64-character hexadecimal hash
- `confirmedAt`: Unix timestamp (optional)

**Response** (200 OK):
```json
{
  "data": {
    "id": "1",
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC"],
    "assetCode": "USDC",
    "targetAmount": 1000,
    "pledgedAmount": 1000,
    "deadline": 1705334400,
    "createdAt": 1704729600,
    "claimedAt": 1705334500,
    "failedAt": null,
    "deletedAt": null,
    "metadata": null,
    "maxPerContributor": null,
    "tokenBalances": {
      "USDC": 1000
    },
    "progress": {
      "status": "claimed",
      "percentFunded": 100,
      "remainingAmount": 0,
      "pledgeCount": 20,
      "hoursLeft": 0,
      "canPledge": false,
      "canClaim": false,
      "canRefund": false
    }
  }
}
```

**cURL**:
```bash
curl -X POST http://localhost:3000/api/campaigns/1/claim \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "transactionHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }'
```

---

#### POST /api/campaigns/:id/refund

Refund a contributor for a failed campaign after verifying the on-chain transaction.

**Request Body**:
```json
{
  "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "soroban": {
    "txHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "contractId": "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "walletAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "ledger": 12345,
    "createdAt": 1705334600,
    "latestLedger": 12350
  }
}
```

**Validation Rules**:
- `contributor`: Valid Stellar public key
- `soroban.txHash`: 64-character hexadecimal hash
- `soroban.contractId`: Non-empty string
- `soroban.networkPassphrase`: Non-empty string
- `soroban.rpcUrl`: Valid URL
- `soroban.walletAddress`: Valid Stellar public key
- `soroban.ledger`: Positive integer (optional)
- `soroban.createdAt`: Unix timestamp (optional)
- `soroban.latestLedger`: Positive integer (optional)

**Response** (200 OK):
```json
{
  "data": {
    "id": "1",
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Clean Water Initiative",
    "description": "Raising funds to provide clean water access.",
    "acceptedTokens": ["USDC"],
    "assetCode": "USDC",
    "targetAmount": 1000,
    "pledgedAmount": 500,
    "deadline": 1705334400,
    "createdAt": 1704729600,
    "claimedAt": null,
    "failedAt": 1705334700,
    "deletedAt": null,
    "metadata": null,
    "maxPerContributor": null,
    "tokenBalances": {
      "USDC": 450
    },
    "progress": {
      "status": "failed",
      "percentFunded": 50,
      "remainingAmount": 500,
      "pledgeCount": 10,
      "hoursLeft": 0,
      "canPledge": false,
      "canClaim": false,
      "canRefund": true
    },
    "refundedAmount": 50
  }
}
```

**cURL**:
```bash
curl -X POST http://localhost:3000/api/campaigns/1/refund \
  -H "Content-Type: application/json" \
  -d '{
    "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "soroban": {
      "txHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "contractId": "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "networkPassphrase": "Test SDF Network ; September 2015",
      "rpcUrl": "https://soroban-testnet.stellar.org",
      "walletAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }
  }'
```

---

#### GET /api/campaigns/:id/contributors

Get contributor summary for a specific campaign.

**Response** (200 OK):
```json
{
  "data": [
    {
      "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "totalPledged": 150,
      "refundedAmount": 0,
      "isFullyRefunded": false
    }
  ]
}
```

**cURL**:
```bash
curl http://localhost:3000/api/campaigns/1/contributors
```

---

#### GET /api/campaigns/:id/history

Get event history for a specific campaign with pagination.

**Query Parameters**:
- `page`: Page number (default: 1)
- `pageSize`: Items per page 1-100 (default: 20)

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": 1,
      "campaignId": "1",
      "eventType": "created",
      "timestamp": 1704729600,
      "actor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "amount": null,
      "metadata": null,
      "blockchainMetadata": null
    },
    {
      "id": 2,
      "campaignId": "1",
      "eventType": "pledged",
      "timestamp": 1704729700,
      "actor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "amount": 50,
      "metadata": null,
      "blockchainMetadata": null
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 20,
  "hasMore": true
}
```

**cURL**:
```bash
curl "http://localhost:3000/api/campaigns/1/history?page=1&pageSize=20"
```

---

### Miscellaneous

#### GET /api/open-issues

List open development issues from the project.

**Response** (200 OK):
```json
{
  "data": [
    {
      "id": "SGV-1",
      "title": "Implement Freighter-signed pledge transactions",
      "labels": ["enhancement", "soroban"],
      "summary": "Replace mock API pledges with wallet-signed Soroban transactions.",
      "complexity": "High",
      "points": 200
    }
  ]
}
```

**cURL**:
```bash
curl http://localhost:3000/api/open-issues
```

---

#### GET /api/config

Get runtime configuration including supported assets and Soroban settings.

**Response** (200 OK):
```json
{
  "data": {
    "allowedAssets": ["USDC", "XLM"],
    "soroban": {
      "enabled": true,
      "contractId": "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "networkPassphrase": "Test SDF Network ; September 2015",
      "rpcUrl": "https://soroban-testnet.stellar.org"
    },
    "sorobanRpcUrl": "https://soroban-testnet.stellar.org",
    "contractId": "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "contractAmountDecimals": 2,
    "walletIntegrationReady": true,
    "assetAddresses": {
      "USDC": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "XLM": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }
  }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/config
```

---

#### GET /api/stats

Get global campaign and pledge statistics.

**Response** (200 OK):
```json
{
  "data": {
    "totalCampaigns": 42,
    "openCampaigns": 15,
    "fundedCampaigns": 20,
    "claimedCampaigns": 5,
    "failedCampaigns": 2,
    "totalPledgeVolume": 50000,
    "uniqueContributors": 150
  }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/stats
```

---

#### GET /api/leaderboard

Get contributor leaderboard ranked by total pledged amount.

**Query Parameters**:
- `limit`: Number of top contributors to return (1-100, default: 10)

**Response** (200 OK):
```json
{
  "data": [
    {
      "rank": 1,
      "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "totalPledged": 5000,
      "campaignCount": 10,
      "averagePledgeAmount": 500
    },
    {
      "rank": 2,
      "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "totalPledged": 3000,
      "campaignCount": 5,
      "averagePledgeAmount": 600
    }
  ]
}
```

**cURL**:
```bash
curl "http://localhost:3000/api/leaderboard?limit=10"
```

---

#### GET /api/docs

Get the machine-readable OpenAPI 3.1 specification.

**Response** (200 OK):
```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Stellar Goal Vault API",
    "description": "Machine-readable OpenAPI specification for the Stellar Goal Vault backend.",
    "version": "1.0.0"
  },
  "paths": { ... }
}
```

**cURL**:
```bash
curl http://localhost:3000/api/docs
```

---

#### GET /api/docs/ui

Interactive Swagger UI for API exploration.

**cURL**:
```bash
# Open in browser
open http://localhost:3000/api/docs/ui
```

---

## Deprecated Endpoints

None currently deprecated.

---

## Testing Examples

### Test Against Local Backend

Ensure the backend is running locally:

```bash
cd backend
npm run dev
```

Then test endpoints:

```bash
# Health check
curl http://localhost:3000/api/health

# Create a campaign
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "title": "Test Campaign",
    "description": "A test campaign",
    "acceptedTokens": ["USDC"],
    "targetAmount": 100,
    "deadline": 1705334400
  }'

# List campaigns
curl http://localhost:3000/api/campaigns

# Get specific campaign
curl http://localhost:3000/api/campaigns/1

# Create a pledge
curl -X POST http://localhost:3000/api/campaigns/1/pledges \
  -H "Content-Type: application/json" \
  -d '{
    "contributor": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "amount": 10,
    "assetCode": "USDC"
  }'
```

---

## Data Types

### Stellar Address
- Format: 56-character string starting with `G`
- Regex: `^G[A-Z2-7]{55}$`
- Example: `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`

### Asset Code
- Format: 1-12 alphanumeric characters
- Regex: `^[A-Za-z0-9]{1,12}$`
- Example: `USDC`, `XLM`

### Transaction Hash
- Format: 64-character hexadecimal string
- Regex: `^[A-Fa-f0-9]{64}$`
- Example: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

### Unix Timestamp
- Format: Integer seconds since epoch
- Example: `1704729600`

### Campaign Status
- `open`: Campaign is accepting pledges
- `funded`: Campaign reached target before deadline
- `claimed`: Campaign creator claimed funds
- `failed`: Campaign deadline passed without reaching target

### Event Type
- `created`: Campaign was created
- `pledged`: Pledge was added
- `claimed`: Campaign was claimed
- `refunded`: Contributor was refunded
- `updated`: Campaign was updated
- `metadata_updated`: Campaign metadata was updated
