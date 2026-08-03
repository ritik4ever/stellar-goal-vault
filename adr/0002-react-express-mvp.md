# 0002 - React + Express + Soroban MVP Architecture

Status: Accepted

Context:
- The product needs a user-facing campaign dashboard and a backend API to manage state, without requiring a full blockchain deployment up front.
- The Soroban contract scaffold is important for the project roadmap, but the initial experience should still be testable and useful locally.

Decision:
- Build the frontend as a React + Vite dashboard.
- Build the backend as an Express REST API backed by SQLite.
- Keep Soroban contract integration as a separate scaffold and expose contract/network configuration to the frontend for later wallet-enabled workflows.

Consequences:
- Clear separation between UI, backend state, and eventual blockchain integration.
- Contributors can work on frontend, API, and contract pieces independently.
- Provides a practical MVP path that can be extended with on-chain reconciliation and event indexing.
- Leaves room to improve authentication, rate limiting, and contract synchronization later.
