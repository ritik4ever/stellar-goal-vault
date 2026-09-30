import type { Campaign, CampaignEvent } from '../types/campaign';

/**
 * Pure helpers for the campaign-detail loading pipeline.
 *
 * Opening a campaign runs two network requests in parallel — `GET /campaigns/:id`
 * (the detail record, including pledges) and `GET /campaigns/:id/history`
 * (the event feed) — and then does client-side work on what comes back:
 * ordering the history feed, merging successive history pages, and folding the
 * detail record over the summary row already held by the campaign board.
 *
 * That client-side work is what this module isolates. Extracting it keeps the
 * ordering rules in one place (`api.ts` previously re-sorted inline and `App`
 * re-sorted again while merging pages, so the two could drift) and makes the
 * cost measurable from a benchmark instead of being buried in a React effect.
 *
 * Every function is pure and non-mutating: inputs are never reordered in place,
 * and the fast paths return the original reference so React state updates can
 * bail out instead of re-rendering.
 */

/**
 * Page size for the campaign-detail history feed.
 *
 * The initial detail load requests exactly one page (`App.refreshHistory`) and
 * each "load more" requests the next one, so this is both the first-paint cost
 * and the incremental cost of the feed. Kept here as the single source of truth
 * shared with `services/api.ts`.
 */
export const HISTORY_PAGE_SIZE = 20;

/**
 * Stably orders a history feed oldest-first by `timestamp`, then by `id`.
 *
 * The backend already returns a stable order, but pages are fetched by offset
 * while new events can be written concurrently, so a later page can carry an
 * event that sorts before one already loaded. Re-sorting the merged feed after
 * every page keeps the rendered timeline monotonic; `id` is the tie-breaker
 * because two events can share a `timestamp` (same ledger close) and the `id`
 * is the only strictly increasing field.
 */
export function sortHistoryEvents(events: CampaignEvent[]): CampaignEvent[] {
  return [...events].sort((left, right) => left.timestamp - right.timestamp || left.id - right.id);
}

/**
 * Merges a newly fetched history page into the events already loaded.
 *
 * Pages are requested by numeric `page`/`pageSize` offsets, so an event can
 * legitimately be returned twice: a concurrent write shifts the window and an
 * already-rendered event slides into the next page. Ids that are already present
 * are dropped so the timeline cannot render duplicate keys or duplicate rows.
 *
 * @param current - Events already loaded and rendered, in stable order.
 * @param incoming - The next page of events returned by the API.
 * @returns `current` unchanged when the page adds nothing, otherwise a new
 *   array containing the union in `(timestamp, id)` order.
 */
export function mergeHistoryPages(
  current: CampaignEvent[],
  incoming: CampaignEvent[],
): CampaignEvent[] {
  if (incoming.length === 0) {
    return current;
  }

  const seen = new Set(current.map((event) => event.id));
  const unseen = incoming.filter((event) => !seen.has(event.id));

  if (unseen.length === 0) {
    return current;
  }

  return sortHistoryEvents([...current, ...unseen]);
}

/**
 * Folds the fetched detail record over the summary row held by the campaign board.
 *
 * The board's list response is the fast path: it already carries everything the
 * detail panel needs to paint its header, so the panel renders immediately from
 * the summary and is upgraded in place once `GET /campaigns/:id` resolves. Only
 * the fields the detail record actually owns are adopted:
 *
 * - `pledges` comes from the detail record (the list response omits them), and
 *   the reference is passed through untouched so the detail panel's contributor
 *   summary does not re-derive it.
 * - `metadata` prefers the detail record, but falls back to the summary row so a
 *   detail response without metadata cannot blank out an already-visible banner.
 *
 * Field order matters: the summary is the base, so a stale detail record cannot
 * roll back a newer summary value such as `pledgedAmount`.
 *
 * @returns `null` when neither side has a campaign, the detail record when the
 *   board has no matching summary, the summary when the detail record is missing
 *   or belongs to a different campaign, otherwise the merged record.
 */
export function mergeCampaignDetail(
  summary: Campaign | null,
  detail: Campaign | null,
): Campaign | null {
  if (!summary) {
    return detail;
  }

  if (!detail || detail.id !== summary.id) {
    return summary;
  }

  return {
    ...summary,
    pledges: detail.pledges,
    metadata: detail.metadata ?? summary.metadata,
  };
}
