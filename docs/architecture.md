# Architecture Diagrams

These diagrams summarize the current Goal Vault MVP shape: a React frontend, an
Express API, SQLite persistence, and the Soroban/Freighter pledge path.

## Pledge Flow

```mermaid
sequenceDiagram
  autonumber
  actor Contributor
  participant Frontend as React frontend
  participant Backend as Express API
  participant Soroban as Soroban RPC / contract
  participant Freighter as Freighter wallet
  participant SQLite

  Contributor->>Frontend: Enter pledge amount
  Frontend->>Backend: GET /api/config
  Backend-->>Frontend: Network, RPC URL, contract ID, asset config
  Frontend->>Soroban: Simulate contribute(...)
  Soroban-->>Frontend: Prepared transaction details
  Frontend->>Freighter: Request signature
  Freighter-->>Frontend: Signed transaction XDR
  Frontend->>Soroban: Submit signed transaction
  Soroban-->>Frontend: Confirmed transaction hash
  Frontend->>Backend: POST /api/campaigns/:id/pledges/reconcile
  Backend->>SQLite: Store pledge and campaign event
  Backend-->>Frontend: Updated campaign state
```

## Frontend Components

```mermaid
flowchart TD
  App["App.tsx"]
  Config["App config state"]
  Campaigns["Campaign list state"]
  Selected["Selected campaign state"]
  Wallet["Freighter wallet state"]

  CreateForm["CreateCampaignForm"]
  Detail["CampaignDetailPanel"]
  Table["CampaignsTable"]
  Timeline["CampaignTimeline"]
  Contributors["ContributorSummary"]
  Analytics["CreatorAnalytics"]
  Backlog["IssueBacklog"]
  API["frontend/src/services/api.ts"]
  FreighterSvc["frontend/src/services/freighter.ts"]
  Backend["Express API"]
  Soroban["Soroban RPC / contract"]
  Freighter["Freighter extension"]

  App --> Config
  App --> Campaigns
  App --> Selected
  App --> Wallet

  Config --> CreateForm
  Config --> Detail
  Campaigns --> Table
  Campaigns --> Analytics
  Selected --> Detail
  Selected --> Timeline
  Selected --> Contributors
  Wallet --> Detail

  CreateForm --> API
  Table --> API
  Detail --> API
  Timeline --> API
  Backlog --> API

  Detail --> FreighterSvc
  FreighterSvc --> Freighter
  FreighterSvc --> Soroban
  API --> Backend
```

## SQLite Data Flow

```mermaid
erDiagram
  CAMPAIGNS ||--o{ PLEDGES : receives
  CAMPAIGNS ||--o{ CAMPAIGN_EVENTS : records

  CAMPAIGNS {
    string id PK
    string creator
    string title
    string description
    string accepted_tokens_json
    float target_amount
    float pledged_amount
    int deadline
    int created_at
    int claimed_at
    string metadata_json
    int deleted_at
    int max_per_contributor
  }

  PLEDGES {
    int id PK
    string campaign_id FK
    string contributor
    float amount
    string asset_code
    int created_at
    int refunded_at
    string transaction_hash
  }

  CAMPAIGN_EVENTS {
    int id PK
    string campaign_id FK
    string event_type
    int timestamp
    string actor
    float amount
    string metadata
    string blockchain_metadata
  }
```

`campaigns` holds the campaign metadata and aggregate funding state. `pledges`
stores contributor-level amounts, assets, refund markers, and confirmed
transaction hashes. `campaign_events` keeps the local timeline, including
on-chain reconciliation metadata when it is available.
