# Architecture

This document describes the system architecture of Stellar Goal Vault, including component relationships and the campaign lifecycle flow.

## System Overview

```mermaid
graph TB
    subgraph Frontend["Frontend (React + Vite)"]
        UI[Campaign Dashboard]
        CP[CampaignDetailPanel]
        CF[CreateCampaignForm]
        CA[CreatorAnalytics]
    end

    subgraph Backend["Backend (Express + Node.js)"]
        API[REST API Routes]
        CS[campaignStore Service]
        VS[Validation Schemas]
    end

    subgraph Storage["Data Storage"]
        DB[(SQLite / campaigns.db)]
    end

    subgraph Blockchain["Stellar Soroban (Smart Contract)"]
        SC[Escrow Contract]
        EV[Contract Events]
    end

    subgraph External["External Services"]
        H[Horizon RPC]
        FW[Freighter Wallet]
    end

    Frontend -->|HTTP /api/*| Backend
    Backend -->|Read/Write| Storage
    Frontend -->|Soroban SDK| Blockchain
    Backend -->|Soroban SDK| Blockchain
    Blockchain -->|Transaction Queries| H
    Frontend -->|Signature Requests| FW
```

## Campaign Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft: Creator creates
    Draft --> Active: Funded & Open
    Active --> Pledged: Backer pledges
    Pledged --> Funded: Goal reached
    Funded --> Completed: Creator claims
    Funded --> Failed: Deadline passes
    Failed --> Refunded: Backers refund
    Active --> Failed: Deadline without goal
    Completed --> [*]
    Refunded --> [*]
```

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant DB as SQLite DB
    participant Contract as Soroban Contract

    User->>Frontend: Create campaign
    Frontend->>Backend: POST /api/campaigns
    Backend->>DB: Insert campaign record
    Backend-->>Frontend: Campaign created
    Frontend->>Contract: Create escrow
    Contract-->>Frontend: Escrow address

    User->>Frontend: Pledge to campaign
    Frontend->>Contract: Pledge tokens
    Contract-->>Frontend: Pledge confirmed
    Frontend->>Backend: POST /api/pledges
    Backend->>DB: Record pledge
    Backend-->>Frontend: Pledge recorded

    alt Goal reached
        User->>Frontend: Claim funds
        Frontend->>Contract: Claim
        Contract-->>Frontend: Funds released
        Frontend->>Backend: Update campaign status
        Backend-->>Frontend: Campaign completed
    else Deadline passed
        User->>Frontend: Refund pledge
        Frontend->>Contract: Refund
        Contract-->>Frontend: Tokens returned
        Frontend->>Backend: Update pledge status
        Backend-->>Frontend: Pledge refunded
    end
```

## Component Breakdown

### Frontend (`frontend/`)

React + Vite application for creating and managing Stellar crowdfunding campaigns.

| File | Responsibility |
|------|----------------|
| `src/App.tsx` | Main application, routing, state management |
| `components/CampaignDetailPanel.tsx` | Campaign detail view with pledge actions |
| `components/CreateCampaignForm.tsx` | Campaign creation form with validation |
| `components/CreatorAnalytics.tsx` | Creator dashboard with campaign analytics |
| `components/CampaignCard.tsx` | Campaign list card component |
| `components/CampaignsTable.tsx` | Tabular campaign list view |

### Backend (`backend/`)

Express REST API managing campaign state with SQLite persistence.

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Express app setup, routes, middleware |
| `src/services/campaignStore.ts` | CRUD operations, state transitions |
| `src/validation/schemas.ts` | Zod validation schemas |
| `src/logger.ts` | Structured logging |

### Smart Contract (`contracts/`)

Soroban contract implementing on-chain escrow logic.

| File | Responsibility |
|------|----------------|
| `src/lib.rs` | Escrow contract with create, pledge, claim, refund |
| `src/test.rs` | Contract unit tests |

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Lucide icons
- **Backend:** Express.js, Zod validation, SQLite (better-sqlite3)
- **Contracts:** Soroban SDK, Rust, Cargo
- **Tools:** Vitest, Playwright, Storybook

## See Also

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — Production deployment guide
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — How to contribute
