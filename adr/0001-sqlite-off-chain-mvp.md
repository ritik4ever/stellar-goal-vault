# 0001 - SQLite Off-chain MVP

Status: Accepted

Context:
- The project is a lightweight crowdfunding MVP with React, Express, and a Soroban contract scaffold.
- Early contributors need a simple persistence layer that works reliably for local development and demos.
- On-chain contract integration is planned but not yet fully wired into the frontend pledge flow.

Decision:
- Use SQLite for backend persistence of campaigns, pledges, and event history.
- Keep campaign state and pledge tracking off-chain for the MVP, while preserving the ability to reconcile confirmed on-chain pledges.
- Store local campaign state in SQLite and expose it through the Express API, with a future path to index blockchain events into the same database.

Consequences:
- Low infrastructure overhead and fast setup for contributors.
- A reliable local data source that supports the current React/Express MVP flow.
- Enables incremental delivery: the app can work before full Soroban wallet integration is complete.
- Creates a clear migration point for a later production implementation that may move more state on-chain.
