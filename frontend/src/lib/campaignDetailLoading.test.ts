import { describe, expect, it } from 'vitest';

import type { Campaign, CampaignEvent } from '../types/campaign';
import {
  HISTORY_PAGE_SIZE,
  mergeCampaignDetail,
  mergeHistoryPages,
  sortHistoryEvents,
} from './campaignDetailLoading';

const CAMPAIGN_ID = 'campaign-detail-1';

function makeEvent(id: number, timestamp: number): CampaignEvent {
  return {
    id,
    campaignId: CAMPAIGN_ID,
    eventType: id % 2 === 0 ? 'pledged' : 'created',
    timestamp,
    actor: `G${'A'.repeat(55)}`,
    amount: id * 10,
  };
}

function makeCampaign(id: string, pledgedAmount: number): Campaign {
  return {
    id,
    creator: `G${'A'.repeat(55)}`,
    title: `Campaign ${id}`,
    description: 'Fixture campaign for the detail-loading helpers.',
    acceptedTokens: ['USDC'],
    assetCode: 'USDC',
    targetAmount: 10_000,
    pledgedAmount,
    deadline: 1_700_086_400,
    createdAt: 1_699_000_000,
    progress: {
      status: 'open',
      percentFunded: 25,
      remainingAmount: 7_500,
      pledgeCount: 3,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  };
}

describe('HISTORY_PAGE_SIZE', () => {
  it('is the bounded first page requested by the detail load', () => {
    expect(HISTORY_PAGE_SIZE).toBe(20);
  });
});

describe('sortHistoryEvents', () => {
  it('orders events ascending by timestamp, then by id', () => {
    const events = [makeEvent(9, 300), makeEvent(4, 100), makeEvent(3, 100), makeEvent(7, 200)];

    expect(sortHistoryEvents(events).map((event) => event.id)).toEqual([3, 4, 7, 9]);
  });

  it('uses id to break timestamp ties so the order is total, not arbitrary', () => {
    const events = [makeEvent(12, 500), makeEvent(2, 500), makeEvent(8, 500)];

    expect(sortHistoryEvents(events).map((event) => event.id)).toEqual([2, 8, 12]);
  });

  it('does not mutate the input array', () => {
    const events = [makeEvent(2, 200), makeEvent(1, 100)];
    const snapshot = events.slice();

    sortHistoryEvents(events);

    expect(events).toEqual(snapshot);
    expect(events[0].id).toBe(2);
  });

  it('always returns a copy so callers never share sorted state', () => {
    const events = [makeEvent(1, 100), makeEvent(2, 200)];
    expect(sortHistoryEvents(events)).not.toBe(events);
  });
});

describe('mergeHistoryPages', () => {
  it('returns the current reference when the incoming page is empty', () => {
    const current = [makeEvent(1, 100)];
    expect(mergeHistoryPages(current, [])).toBe(current);
  });

  it('returns the current reference when every incoming event is already loaded', () => {
    const current = [makeEvent(1, 100), makeEvent(2, 200)];
    const overlapping = [makeEvent(2, 200), makeEvent(1, 100)];

    expect(mergeHistoryPages(current, overlapping)).toBe(current);
  });

  it('drops duplicate ids and keeps the union exactly once each', () => {
    const current = [makeEvent(1, 100), makeEvent(2, 200)];
    const incoming = [makeEvent(2, 200), makeEvent(3, 300)];

    const merged = mergeHistoryPages(current, incoming);

    expect(merged.map((event) => event.id)).toEqual([1, 2, 3]);
  });

  it('re-sorts a later page that carries an event older than the loaded window', () => {
    const current = [makeEvent(5, 500), makeEvent(6, 600)];
    const incoming = [makeEvent(2, 200), makeEvent(7, 700)];

    expect(mergeHistoryPages(current, incoming).map((event) => event.id)).toEqual([2, 5, 6, 7]);
  });

  it('keeps the merged feed monotonic across several interleaved pages', () => {
    let feed: CampaignEvent[] = sortHistoryEvents([makeEvent(4, 400), makeEvent(1, 100)]);

    feed = mergeHistoryPages(feed, [makeEvent(3, 300), makeEvent(2, 200)]);
    feed = mergeHistoryPages(feed, [makeEvent(6, 600), makeEvent(5, 500)]);

    expect(feed.map((event) => event.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not mutate either input array', () => {
    const current = [makeEvent(3, 300)];
    const incoming = [makeEvent(1, 100)];
    const currentSnapshot = current.slice();
    const incomingSnapshot = incoming.slice();

    mergeHistoryPages(current, incoming);

    expect(current).toEqual(currentSnapshot);
    expect(incoming).toEqual(incomingSnapshot);
  });
});

describe('mergeCampaignDetail', () => {
  it('returns null when neither side has a campaign', () => {
    expect(mergeCampaignDetail(null, null)).toBeNull();
  });

  it('returns the detail record when the board has no summary row', () => {
    const detail = makeCampaign(CAMPAIGN_ID, 50);
    expect(mergeCampaignDetail(null, detail)).toBe(detail);
  });

  it('returns the summary when the detail record has not loaded yet', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 50);
    expect(mergeCampaignDetail(summary, null)).toBe(summary);
  });

  it('ignores a detail record for a different campaign', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 50);
    const other = makeCampaign('campaign-other', 999);

    expect(mergeCampaignDetail(summary, other)).toBe(summary);
  });

  it('adopts the detail pledges by reference and the detail metadata', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 50);
    const detail = makeCampaign(CAMPAIGN_ID, 50);
    detail.pledges = [
      {
        id: 1,
        campaignId: CAMPAIGN_ID,
        contributor: 'GABC',
        amount: 10,
        assetCode: 'USDC',
        createdAt: 1,
      },
    ];
    detail.metadata = { imageUrl: 'https://example.test/banner.png' };

    const merged = mergeCampaignDetail(summary, detail);

    expect(merged?.pledges).toBe(detail.pledges);
    expect(merged?.metadata).toEqual({ imageUrl: 'https://example.test/banner.png' });
  });

  it('falls back to the summary metadata when the detail record omits it', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 50);
    summary.metadata = { imageUrl: 'https://example.test/summary.png' };
    const detail = makeCampaign(CAMPAIGN_ID, 50);

    expect(mergeCampaignDetail(summary, detail)?.metadata).toEqual({
      imageUrl: 'https://example.test/summary.png',
    });
  });

  it('keeps the summary scalar fields so a stale detail cannot roll them back', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 750);
    const staleDetail = makeCampaign(CAMPAIGN_ID, 500);
    staleDetail.title = 'Stale title';
    summary.title = 'Fresh title';

    const merged = mergeCampaignDetail(summary, staleDetail);

    expect(merged?.pledgedAmount).toBe(750);
    expect(merged?.title).toBe('Fresh title');
  });

  it('returns a new object rather than mutating the summary', () => {
    const summary = makeCampaign(CAMPAIGN_ID, 50);
    const detail = makeCampaign(CAMPAIGN_ID, 50);
    detail.pledges = [];

    const merged = mergeCampaignDetail(summary, detail);

    expect(merged).not.toBe(summary);
    expect(summary.pledges).toBeUndefined();
  });
});
