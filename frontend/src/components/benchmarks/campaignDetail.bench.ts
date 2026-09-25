import { bench, describe } from 'vitest';

import type { Campaign, CampaignEvent, Pledge } from '../../types/campaign';
import {
  HISTORY_PAGE_SIZE,
  mergeCampaignDetail,
  mergeHistoryPages,
  sortHistoryEvents,
} from '../../lib/campaignDetailLoading';

/**
 * Repeatable benchmark for the campaign-detail loading pipeline (issue #1002).
 *
 * Opening a campaign issues two network requests in parallel — the detail record
 * (`GET /campaigns/:id`) and the first history page
 * (`GET /campaigns/:id/history?page=1&pageSize=20`) — and then does client-side
 * work on what returns:
 *
 *   1. `sortHistoryEvents`   — called by the history transport on every page.
 *   2. `mergeHistoryPages`   — called on every "load more" to dedupe and
 *                              re-order the union of the loaded pages.
 *   3. `mergeCampaignDetail` — called on every render where either the board
 *                              summary or the fetched detail changes.
 *
 * The network latency itself cannot be benchmarked offline, so this file pins the
 * CPU-side work against deterministic fixtures generated in-process — no network
 * access and no mutable external data.
 *
 * Input sizes: history windows of 20 / 200 / 2,000 events (1, 10 and 100 loaded
 * pages at `HISTORY_PAGE_SIZE`) and detail records carrying 0 / 100 / 1,000
 * pledges. Run `npm run bench` (or `npx vitest bench --run`) and compare `hz`
 * across runs on the same machine.
 */

const CAMPAIGN_ID = 'campaign-detail-0';
const BASE_TIME = 1_700_000_000;

function makeEvent(id: number, timestamp: number): CampaignEvent {
  return {
    id,
    campaignId: CAMPAIGN_ID,
    eventType: id % 2 === 0 ? 'pledged' : 'created',
    timestamp,
    actor: `G${'A'.repeat(55)}`,
    amount: (id * 13) % 5_000,
  };
}

/**
 * `count` events in the order the API returns them: oldest-first by
 * `(timestamp, id)`. Timestamps collide on purpose — one shared close time per
 * history page — so the `id` tie-breaker is exercised on every sort.
 */
function makeOrderedWindow(count: number): CampaignEvent[] {
  return Array.from({ length: count }, (_, index) =>
    makeEvent(index, BASE_TIME + Math.floor(index / HISTORY_PAGE_SIZE) * 5),
  );
}

/**
 * A page of unseen events whose timestamps interleave *inside* the loaded
 * window — the backfill case where the indexer writes events for an earlier
 * ledger after newer events are already on screen. Merging it forces the union
 * to be re-sorted rather than appended.
 */
function makeInterleavedPage(startId: number, count: number): CampaignEvent[] {
  return Array.from({ length: count }, (_, offset) =>
    makeEvent(startId + offset, BASE_TIME - (count - offset)),
  );
}

function makePledge(index: number): Pledge {
  return {
    id: index,
    campaignId: CAMPAIGN_ID,
    contributor: `G${'B'.repeat(55)}`,
    amount: (index * 7) % 1_000,
    assetCode: 'USDC',
    createdAt: BASE_TIME + index,
  };
}

function makeCampaign(pledgeCount: number): Campaign {
  return {
    id: CAMPAIGN_ID,
    creator: `G${'A'.repeat(55)}`,
    title: 'Deterministic detail campaign',
    description: 'Fixture used to benchmark the campaign-detail loading pipeline.',
    acceptedTokens: ['USDC'],
    assetCode: 'USDC',
    targetAmount: 100_000,
    pledgedAmount: 42_000,
    deadline: BASE_TIME + 86_400,
    createdAt: BASE_TIME - 86_400,
    progress: {
      status: 'open',
      percentFunded: 42,
      remainingAmount: 58_000,
      pledgeCount,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
    pledges: Array.from({ length: pledgeCount }, (_, index) => makePledge(index)),
    metadata: { imageUrl: 'https://example.test/banner.png' },
  };
}

// Every fixture is built once, outside the timed callbacks, so each benchmark
// measures the helper under test rather than its own input construction.
const HISTORY_WINDOW_SIZES = [HISTORY_PAGE_SIZE, 200, 2_000];

for (const windowSize of HISTORY_WINDOW_SIZES) {
  const loadedWindow = makeOrderedWindow(windowSize);
  const orderedFirstPage = loadedWindow.slice(0, HISTORY_PAGE_SIZE);
  const reversedFirstPage = orderedFirstPage.slice().reverse();
  const nextUnseenPage = makeInterleavedPage(100_000, HISTORY_PAGE_SIZE);

  describe(`campaign detail loading — ${windowSize.toLocaleString('en-US')} loaded history events`, () => {
    bench(`sortHistoryEvents(ordered page of ${HISTORY_PAGE_SIZE})`, () => {
      // The steady state: the API already returns pages in order, so the
      // transport's defensive re-sort is a linear scan.
      sortHistoryEvents(orderedFirstPage);
    });

    bench(`sortHistoryEvents(reversed page of ${HISTORY_PAGE_SIZE})`, () => {
      // The page arrives out of order, so the full `n log n` sort runs.
      sortHistoryEvents(reversedFirstPage);
    });

    bench('mergeHistoryPages(current, next unseen page)', () => {
      // Steady-state "load more": one fresh page merged into the window
      // already on screen. The page interleaves, so the union is re-sorted.
      mergeHistoryPages(loadedWindow, nextUnseenPage);
    });

    bench('mergeHistoryPages(current, fully overlapping page)', () => {
      // Worst case for the dedupe scan and the reference-identity fast path:
      // every incoming id is already loaded, so no re-sort is needed.
      mergeHistoryPages(loadedWindow, orderedFirstPage);
    });
  });
}

describe('campaign detail loading — detail record merge', () => {
  const summary = makeCampaign(0);
  const detailNoPledges = makeCampaign(0);
  const detail100Pledges = makeCampaign(100);
  const detail1000Pledges = makeCampaign(1_000);

  bench('mergeCampaignDetail(summary, detail with 0 pledges)', () => {
    mergeCampaignDetail(summary, detailNoPledges);
  });

  bench('mergeCampaignDetail(summary, detail with 100 pledges)', () => {
    mergeCampaignDetail(summary, detail100Pledges);
  });

  bench('mergeCampaignDetail(summary, detail with 1,000 pledges)', () => {
    mergeCampaignDetail(summary, detail1000Pledges);
  });

  bench('mergeCampaignDetail(summary, no detail yet)', () => {
    // The first paint after the board response: summary only, detail in flight.
    mergeCampaignDetail(summary, null);
  });
});
