/**
 * Correctness-at-scale tests for the campaign-detail loading pipeline (issue #1002).
 *
 * These tests use the same deterministic 10,000-event fixture formula as the
 * companion benchmark (`campaignDetail.bench.ts`) to catch algorithmic or
 * data-model regressions that only surface at larger cardinalities — e.g. a
 * dropped-duplicate filter that removes live rows, a sort that is not total when
 * timestamps collide, or a merge that mutates the loaded window.
 *
 * Design principles:
 * - Every assertion is a cardinality or ordering invariant derived from the
 *   deterministic fixture formula, never a micro-timing measurement, so the
 *   suite is stable on any hardware.
 * - The fixtures are built once per module so individual test runtime is
 *   proportional to assertion work, not setup work.
 * - Unit-level behaviour of each helper is covered in
 *   `src/lib/campaignDetailLoading.test.ts`; this suite only covers
 *   composition and scale.
 */

import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignEvent, Pledge } from '../../types/campaign';
import {
  HISTORY_PAGE_SIZE,
  mergeCampaignDetail,
  mergeHistoryPages,
  sortHistoryEvents,
} from '../../lib/campaignDetailLoading';

const CAMPAIGN_ID = 'campaign-detail-scale';
const BASE_TIME = 1_700_000_000;
const DATASET_SIZE = 10_000;

function makeEvent(id: number, timestamp: number): CampaignEvent {
  return {
    id,
    campaignId: CAMPAIGN_ID,
    eventType: id % 2 === 0 ? 'pledged' : 'created',
    timestamp,
    actor: `G${'C'.repeat(55)}`,
    amount: (id * 11) % 9_000,
  };
}

/**
 * `DATASET_SIZE` events laid out in the API's stable order: oldest-first by
 * `(timestamp, id)`, with one shared close time per `HISTORY_PAGE_SIZE` events.
 */
function makeOrderedEvents(): CampaignEvent[] {
  return Array.from({ length: DATASET_SIZE }, (_, index) =>
    makeEvent(index, BASE_TIME + Math.floor(index / HISTORY_PAGE_SIZE) * 5),
  );
}

/** The same events in reverse order, i.e. the worst case for the sort. */
function makeReversedEvents(): CampaignEvent[] {
  return makeOrderedEvents().reverse();
}

const ORDERED_EVENTS = makeOrderedEvents();
const REVERSED_EVENTS = makeReversedEvents();

/** Number of distinct timestamps in the fixture: one per history page. */
const DISTINCT_TIMESTAMPS = DATASET_SIZE / HISTORY_PAGE_SIZE;

function expectMonotonic(events: CampaignEvent[]): void {
  for (let i = 0; i < events.length - 1; i++) {
    const previous = events[i];
    const next = events[i + 1];
    const ordered =
      previous.timestamp < next.timestamp ||
      (previous.timestamp === next.timestamp && previous.id <= next.id);
    expect(ordered).toBe(true);
  }
}

describe('campaign detail pipeline at 10,000 history events', () => {
  describe('sortHistoryEvents', () => {
    it('produces a total order across the full dataset', () => {
      const sorted = sortHistoryEvents(REVERSED_EVENTS);

      expect(sorted).toHaveLength(DATASET_SIZE);
      expectMonotonic(sorted);
    });

    it('is a permutation of the input — no event is dropped or duplicated', () => {
      const sorted = sortHistoryEvents(REVERSED_EVENTS);

      expect(new Set(sorted.map((event) => event.id)).size).toBe(DATASET_SIZE);
      expect(sorted.map((event) => event.id).sort((a, b) => a - b)).toEqual(
        REVERSED_EVENTS.map((event) => event.id).sort((a, b) => a - b),
      );
    });

    it('breaks timestamp ties by id so the order is deterministic', () => {
      const sorted = sortHistoryEvents(REVERSED_EVENTS);

      // Within one shared close time, ids must ascend.
      const firstPage = sorted.slice(0, HISTORY_PAGE_SIZE).map((event) => event.id);
      expect(firstPage).toEqual(Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => index));
      expect(sorted.filter((event) => event.timestamp === BASE_TIME)).toHaveLength(
        HISTORY_PAGE_SIZE,
      );
    });

    it('does not mutate the input array at scale', () => {
      const snapshot = REVERSED_EVENTS.slice();

      sortHistoryEvents(REVERSED_EVENTS);

      expect(REVERSED_EVENTS).toEqual(snapshot);
    });

    it('covers every distinct timestamp in the fixture', () => {
      const sorted = sortHistoryEvents(REVERSED_EVENTS);
      const distinct = new Set(sorted.map((event) => event.timestamp));

      expect(distinct.size).toBe(DISTINCT_TIMESTAMPS);
    });
  });

  describe('mergeHistoryPages', () => {
    it('returns the current reference when the page adds nothing new', () => {
      expect(mergeHistoryPages(ORDERED_EVENTS, ORDERED_EVENTS)).toBe(ORDERED_EVENTS);
      expect(mergeHistoryPages(ORDERED_EVENTS, [])).toBe(ORDERED_EVENTS);
    });

    it('keeps the union exactly once when pages fully overlap', () => {
      const firstHalf = ORDERED_EVENTS.slice(0, DATASET_SIZE / 2);
      const merged = mergeHistoryPages(ORDERED_EVENTS, firstHalf);

      expect(merged).toHaveLength(DATASET_SIZE);
      expect(new Set(merged.map((event) => event.id)).size).toBe(DATASET_SIZE);
    });

    it('appends exactly the unseen events of a partially overlapping page', () => {
      const overlap = ORDERED_EVENTS.slice(0, 200);
      const incoming = [...ORDERED_EVENTS.slice(100, 200), ...REVERSED_EVENTS.slice(0, 50)];

      const merged = mergeHistoryPages(overlap, incoming);

      // 200 already loaded + 50 genuinely new.
      expect(merged).toHaveLength(250);
      expect(new Set(merged.map((event) => event.id)).size).toBe(250);
    });

    it('re-sorts a backfilled page that interleaves with the loaded window', () => {
      const loaded = ORDERED_EVENTS.slice(HISTORY_PAGE_SIZE);
      const backfilled = Array.from({ length: HISTORY_PAGE_SIZE }, (_, offset) =>
        makeEvent(500_000 + offset, BASE_TIME - (HISTORY_PAGE_SIZE - offset)),
      );

      const merged = mergeHistoryPages(loaded, backfilled);

      expect(merged).toHaveLength(DATASET_SIZE);
      expectMonotonic(merged);
      // The backfilled events sort before every event of the loaded window.
      expect(merged.slice(0, HISTORY_PAGE_SIZE).map((event) => event.id)).toEqual(
        backfilled.map((event) => event.id),
      );
    });

    it('does not mutate either input array at scale', () => {
      const current = ORDERED_EVENTS.slice(0, 500);
      const incoming = makeReversedEvents().slice(0, 100);
      const currentSnapshot = current.slice();
      const incomingSnapshot = incoming.slice();

      mergeHistoryPages(current, incoming);

      expect(current).toEqual(currentSnapshot);
      expect(incoming).toEqual(incomingSnapshot);
    });
  });

  describe('mergeCampaignDetail', () => {
    const pledges: Pledge[] = Array.from({ length: DATASET_SIZE }, (_, index) => ({
      id: index,
      campaignId: CAMPAIGN_ID,
      contributor: `G${'D'.repeat(55)}`,
      amount: (index * 3) % 1_000,
      assetCode: 'USDC',
      createdAt: BASE_TIME + index,
    }));

    function makeSummary(): Campaign {
      return {
        id: CAMPAIGN_ID,
        creator: `G${'A'.repeat(55)}`,
        title: 'Scale summary',
        description: 'Summary row from the campaign board.',
        acceptedTokens: ['USDC'],
        assetCode: 'USDC',
        targetAmount: 1_000_000,
        pledgedAmount: 750_000,
        deadline: BASE_TIME + 86_400,
        createdAt: BASE_TIME - 86_400,
        progress: {
          status: 'open',
          percentFunded: 75,
          remainingAmount: 250_000,
          pledgeCount: DATASET_SIZE,
          hoursLeft: 24,
          canPledge: true,
          canClaim: false,
          canRefund: false,
        },
        metadata: { imageUrl: 'https://example.test/summary.png' },
      };
    }

    function makeDetail(): Campaign {
      const detail = makeSummary();
      detail.pledgedAmount = 1; // stale on purpose
      detail.pledges = pledges;
      detail.metadata = undefined;
      return detail;
    }

    it('adopts the 10,000-pledge array by reference, without copying it', () => {
      const merged = mergeCampaignDetail(makeSummary(), makeDetail());

      expect(merged?.pledges).toBe(pledges);
      expect(merged?.pledges).toHaveLength(DATASET_SIZE);
    });

    it('keeps the newer summary scalars and the summary metadata fallback', () => {
      const merged = mergeCampaignDetail(makeSummary(), makeDetail());

      expect(merged?.pledgedAmount).toBe(750_000);
      expect(merged?.progress.pledgeCount).toBe(DATASET_SIZE);
      expect(merged?.metadata).toEqual({ imageUrl: 'https://example.test/summary.png' });
    });

    it('returns the summary reference while the detail request is in flight', () => {
      const summary = makeSummary();
      expect(mergeCampaignDetail(summary, null)).toBe(summary);
    });
  });
});
