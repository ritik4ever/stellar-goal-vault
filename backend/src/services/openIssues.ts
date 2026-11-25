/**
 * @module openIssues
 *
 * Manages the seeded list of open-source contribution ideas exposed via
 * `GET /api/open-issues`. This endpoint powers the **Contribution Backlog**
 * panel in the frontend dashboard.
 *
 * ## Adding a new issue
 *
 * 1. Open this file (`backend/src/services/openIssues.ts`).
 * 2. Append a new entry to the `seededIssues` array following the `OpenIssue`
 *    interface below. Choose an `id` that continues the `SGV-N` sequence.
 * 3. Pick an appropriate `complexity` value and the matching `points`:
 *    - `"Trivial"` → `100` points  (small, well-scoped UI / config changes)
 *    - `"Medium"`  → `150` points  (backend service or moderate full-stack work)
 *    - `"High"`    → `200` points  (cross-layer feature or Soroban contract work)
 * 4. The new issue will be served immediately — no migration or restart required.
 *
 * @example Adding a new entry
 * ```ts
 * {
 *   id: 'SGV-4',
 *   title: 'Add dark-mode support for CampaignDetailPanel',
 *   labels: ['frontend', 'ux', 'good first issue'],
 *   summary: 'Apply dark/light color tokens to the campaign detail panel and timeline.',
 *   complexity: 'Trivial',
 *   points: 100,
 * }
 * ```
 *
 * @see {@link https://github.com/ritik4ever/stellar-goal-vault/blob/main/docs/API.md#get-apiopen-issues | API.md — GET /api/open-issues}
 * @see {@link https://github.com/ritik4ever/stellar-goal-vault/blob/main/CONTRIBUTING.md | CONTRIBUTING.md}
 */

/**
 * Represents a single open-source contribution idea.
 *
 * These are surfaced via `GET /api/open-issues` and displayed in the
 * frontend Contribution Backlog panel so new contributors can quickly
 * discover actionable work.
 */
export interface OpenIssue {
  /** Unique identifier for the issue (e.g. `"SGV-1"`). */
  id: string;
  /** Short, human-readable issue title. */
  title: string;
  /** GitHub-style label tags (e.g. `["enhancement", "good first issue"]`). */
  labels: string[];
  /** One or two sentence description of the work involved. */
  summary: string;
  /**
   * Estimated implementation effort:
   * - `"Trivial"` — small, well-scoped change (100 points)
   * - `"Medium"`  — moderate full-stack or backend work (150 points)
   * - `"High"`    — cross-layer feature or Soroban contract work (200 points)
   */
  complexity: 'Trivial' | 'Medium' | 'High';
  /**
   * Reward points awarded upon merging a qualifying pull request.
   * Maps directly to `complexity`: Trivial → 100, Medium → 150, High → 200.
   */
  points: 100 | 150 | 200;
}

/**
 * Statically seeded list of open contribution ideas.
 *
 * To add a new issue, append an entry here following the `OpenIssue` interface.
 * See the module-level JSDoc for the full guide.
 */
const seededIssues: OpenIssue[] = [
  {
    id: 'SGV-1',
    title: 'Implement Freighter-signed pledge transactions',
    labels: ['enhancement', 'help wanted', 'soroban'],
    summary:
      'Replace mock API pledges with wallet-signed Soroban transactions, then surface transaction hashes and simulation errors in the UI timeline.',
    complexity: 'High',
    points: 200,
  },
  {
    id: 'SGV-2',
    title: 'Sync campaign status from Soroban events',
    labels: ['backend', 'indexer', 'good first issue'],
    summary:
      'Add an RPC event indexer that backfills pledge, claim, and refund events so local SQLite stays aligned with on-chain campaign activity.',
    complexity: 'Medium',
    points: 150,
  },
  {
    id: 'SGV-3',
    title: 'Add campaign filtering and sort presets',
    labels: ['frontend', 'ux', 'good first issue'],
    summary:
      'Support filtering by asset and status, plus quick sorts for nearing-deadline and most-funded campaigns to improve the contributor dashboard.',
    complexity: 'Trivial',
    points: 100,
  },
];

/**
 * Returns the full list of seeded open-source contribution ideas.
 *
 * Called by the `GET /api/open-issues` route handler in `index.ts`.
 * The function is async to keep the signature consistent with future
 * implementations that may load issues from a database or remote source.
 *
 * @returns A promise that resolves to the array of {@link OpenIssue} objects.
 */
export async function fetchOpenIssues(): Promise<OpenIssue[]> {
  return seededIssues;
}
