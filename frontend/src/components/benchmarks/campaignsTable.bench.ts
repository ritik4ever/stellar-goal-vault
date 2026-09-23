import { bench, describe } from 'vitest';

import type { Campaign, CampaignStatus } from '../../types/campaign';
import { applyFilters, searchCampaigns, sortCampaigns } from '../campaignsTableUtils';

/**
 * Repeatable benchmark for the campaign list pipeline (issue #993).
 *
 * `CampaignsTable` recomputes `search → filter → sort` over the full campaign
 * list on every render (before virtualization slices the visible window), so
 * this benchmark measures exactly that work.
 *
 * Input size: deterministic datasets of 1,000 and 5,000 campaigns.
 * Output metrics: ops/sec (`hz`) plus min/mean/percentiles reported by Vitest.
 *
 * Run with: `npm run bench` (or `npx vitest bench --run`).
 * Everything is generated in-process from a fixed seed — no network or mutable
 * external data.
 */

const ASSETS = ['USDC', 'XLM', 'EURC'] as const;
const STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
const BASE_TIME = 1_700_000_000;

/** Deterministic campaign factory (no randomness). */
function makeCampaign(index: number): Campaign {
  const asset = ASSETS[index % ASSETS.length];
  return {
    id: `campaign-${index}`,
    creator: `G${'A'.repeat(55)}`,
    title: `Campaign ${index}`,
    description: `Deterministic campaign ${index} used to benchmark the list pipeline.`,
    acceptedTokens: [asset],
    assetCode: asset,
    targetAmount: 1000 + (index % 50) * 100,
    pledgedAmount: (index * 7) % 5000,
    deadline: BASE_TIME + 86400 + index,
    createdAt: BASE_TIME - index,
    progress: {
      status: STATUSES[index % STATUSES.length],
      percentFunded: (index * 3) % 100,
      remainingAmount: (index * 5) % 1000,
      pledgeCount: index % 25,
      hoursLeft: index % 72,
      canPledge: index % 2 === 0,
      canClaim: index % 3 === 0,
      canRefund: index % 5 === 0,
    },
  };
}

function makeCampaigns(count: number): Campaign[] {
  return Array.from({ length: count }, (_, index) => makeCampaign(index));
}

const DATASET_SIZES = [1_000, 5_000];

for (const size of DATASET_SIZES) {
  const campaigns = makeCampaigns(size);

  describe(`campaign list pipeline — ${size.toLocaleString('en-US')} campaigns`, () => {
    bench('search(all) + filter(USDC, open) + sort(pledgedAmount)', () => {
      const filtered = applyFilters(searchCampaigns(campaigns, ''), 'USDC', 'open');
      sortCampaigns(filtered, 'pledgedAmount');
    });

    bench('search(match) + sort(createdAt)', () => {
      const filtered = searchCampaigns(campaigns, 'Campaign 42');
      sortCampaigns(filtered, 'createdAt');
    });

    bench('search(all) + sort(deadline)', () => {
      sortCampaigns(campaigns, 'deadline');
    });
  });
}
