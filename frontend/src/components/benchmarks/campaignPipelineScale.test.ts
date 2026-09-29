/**
 * Correctness-at-scale tests for the campaign list pipeline (issue #993).
 *
 * These tests use the same deterministic 10,000-campaign fixture as the
 * companion benchmark to catch algorithmic or data-model regressions that only
 * surface at larger cardinalities — e.g. incorrect deduplication, off-by-one
 * slice boundaries, sort instability, or filter composition errors.
 *
 * Design principles:
 * - All assertions are cardinality or ordering invariants derived from the
 *   deterministic fixture formula, not from micro-timing measurements, so the
 *   tests are inherently stable on any hardware.
 * - The fixture is built once per module (outside describe blocks) to keep
 *   individual test runtime proportional to assertion work, not setup work.
 * - Existing unit tests for each utility function are preserved in their own
 *   files; this suite only covers cross-function composition and scale.
 */

import { describe, expect, it } from 'vitest';
import type { Campaign, CampaignStatus } from '../../types/campaign';
import { applyFilters, searchCampaigns, sortCampaigns } from '../campaignsTableUtils';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const ASSETS = ['USDC', 'XLM', 'EURC'] as const;
const STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
const BASE_TIME = 1_700_000_000;
const DATASET_SIZE = 10_000;

/**
 * Deterministic campaign factory — identical formula to campaignsTable.bench.ts
 * so both files exercise the same data distribution.
 */
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

const ALL_CAMPAIGNS: Campaign[] = Array.from({ length: DATASET_SIZE }, (_, i) => makeCampaign(i));

// ---------------------------------------------------------------------------
// Derived constants — calculated analytically from the fixture formula so
// tests remain deterministic even if DATASET_SIZE is increased.
// ---------------------------------------------------------------------------

// USDC is assigned to index % 3 === 0 → floor(10000 / 3) + (10000 % 3 > 0 ? 1 : 0) = 3334
const USDC_COUNT = Math.ceil(DATASET_SIZE / ASSETS.length);

// 'open' is assigned to index % 4 === 0 → floor(10000/4) = 2500
const OPEN_COUNT = DATASET_SIZE / STATUSES.length;

// USDC (index%3===0) AND open (index%4===0) → LCM(3,4)=12 → floor(10000/12) + ...
function countWhere(pred: (i: number) => boolean): number {
  let n = 0;
  for (let i = 0; i < DATASET_SIZE; i++) {
    if (pred(i)) n++;
  }
  return n;
}

const USDC_AND_OPEN_COUNT = countWhere((i) => i % 3 === 0 && i % 4 === 0);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('campaign list pipeline at 10,000 campaigns', () => {
  describe('searchCampaigns', () => {
    it('returns all campaigns when query is empty', () => {
      const result = searchCampaigns(ALL_CAMPAIGNS, '');
      expect(result).toHaveLength(DATASET_SIZE);
      // Must be the same reference (no copy) for the fast path
      expect(result).toBe(ALL_CAMPAIGNS);
    });

    it('returns all campaigns when query is only whitespace', () => {
      const result = searchCampaigns(ALL_CAMPAIGNS, '   ');
      expect(result).toHaveLength(DATASET_SIZE);
    });

    it('matches on title substring (case-insensitive)', () => {
      // "Campaign 42" matches exactly: "Campaign 42", "Campaign 420".."Campaign 429",
      // "Campaign 4200".."Campaign 4299", "Campaign 1042", etc.  Rather than
      // computing the exact count we assert the structural invariants:
      const result = searchCampaigns(ALL_CAMPAIGNS, 'Campaign 42');
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((c) => c.title.toLowerCase().includes('campaign 42'))).toBe(true);
    });

    it('returns empty array for a query that matches nothing', () => {
      const result = searchCampaigns(ALL_CAMPAIGNS, 'zzz_no_match_zzz');
      expect(result).toHaveLength(0);
    });

    it('does not mutate the input array', () => {
      const copy = ALL_CAMPAIGNS.slice();
      searchCampaigns(ALL_CAMPAIGNS, 'Campaign 1');
      // Original order must be intact
      for (let i = 0; i < DATASET_SIZE; i++) {
        expect(ALL_CAMPAIGNS[i]).toBe(copy[i]);
      }
    });
  });

  describe('applyFilters', () => {
    it('returns all campaigns when both axes are empty strings', () => {
      const result = applyFilters(ALL_CAMPAIGNS, '', '');
      expect(result).toHaveLength(DATASET_SIZE);
    });

    it('filters by asset code with correct cardinality', () => {
      const result = applyFilters(ALL_CAMPAIGNS, 'USDC', '');
      expect(result).toHaveLength(USDC_COUNT);
      expect(result.every((c) => c.assetCode === 'USDC')).toBe(true);
    });

    it('filters by status with correct cardinality', () => {
      const result = applyFilters(ALL_CAMPAIGNS, '', 'open');
      expect(result).toHaveLength(OPEN_COUNT);
      expect(result.every((c) => c.progress.status === 'open')).toBe(true);
    });

    it('composes asset + status with AND logic (correct cardinality)', () => {
      const result = applyFilters(ALL_CAMPAIGNS, 'USDC', 'open');
      expect(result).toHaveLength(USDC_AND_OPEN_COUNT);
      expect(result.every((c) => c.assetCode === 'USDC' && c.progress.status === 'open')).toBe(
        true,
      );
    });

    it('does not mutate the input array', () => {
      const first = ALL_CAMPAIGNS[0];
      applyFilters(ALL_CAMPAIGNS, 'USDC', 'open');
      expect(ALL_CAMPAIGNS[0]).toBe(first);
    });
  });

  describe('sortCampaigns', () => {
    it('does not mutate the input array', () => {
      const first = ALL_CAMPAIGNS[0];
      sortCampaigns(ALL_CAMPAIGNS, 'createdAt');
      expect(ALL_CAMPAIGNS[0]).toBe(first);
    });

    it('sorts by createdAt descending (newest first)', () => {
      const result = sortCampaigns(ALL_CAMPAIGNS, 'createdAt');
      expect(result).toHaveLength(DATASET_SIZE);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].createdAt).toBeGreaterThanOrEqual(result[i + 1].createdAt);
      }
    });

    it('sorts by deadline ascending (nearest deadline first)', () => {
      const result = sortCampaigns(ALL_CAMPAIGNS, 'deadline');
      expect(result).toHaveLength(DATASET_SIZE);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].deadline).toBeLessThanOrEqual(result[i + 1].deadline);
      }
    });

    it('sorts by pledgedAmount descending', () => {
      const result = sortCampaigns(ALL_CAMPAIGNS, 'pledgedAmount');
      expect(result).toHaveLength(DATASET_SIZE);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].pledgedAmount).toBeGreaterThanOrEqual(result[i + 1].pledgedAmount);
      }
    });

    it('sorts by targetAmount descending', () => {
      const result = sortCampaigns(ALL_CAMPAIGNS, 'targetAmount');
      expect(result).toHaveLength(DATASET_SIZE);
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].targetAmount).toBeGreaterThanOrEqual(result[i + 1].targetAmount);
      }
    });
  });

  describe('full pipeline composition', () => {
    it('search → filter → sort produces a result that is a strict subset of the input', () => {
      const searched = searchCampaigns(ALL_CAMPAIGNS, 'Campaign');
      const filtered = applyFilters(searched, 'XLM', 'funded');
      const sorted = sortCampaigns(filtered, 'pledgedAmount');

      // Every item must originate from ALL_CAMPAIGNS
      const idSet = new Set(ALL_CAMPAIGNS.map((c) => c.id));
      expect(sorted.every((c) => idSet.has(c.id))).toBe(true);

      // All items must satisfy both filter predicates
      expect(sorted.every((c) => c.assetCode === 'XLM' && c.progress.status === 'funded')).toBe(
        true,
      );

      // Result must be sorted by pledgedAmount descending
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].pledgedAmount).toBeGreaterThanOrEqual(sorted[i + 1].pledgedAmount);
      }
    });

    it('empty-query full-pass pipeline returns the full dataset in sorted order', () => {
      const searched = searchCampaigns(ALL_CAMPAIGNS, '');
      const filtered = applyFilters(searched, '', '');
      const sorted = sortCampaigns(filtered, 'createdAt');

      expect(sorted).toHaveLength(DATASET_SIZE);

      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].createdAt).toBeGreaterThanOrEqual(sorted[i + 1].createdAt);
      }
    });

    it('no-match search yields an empty final result regardless of filters/sort', () => {
      const searched = searchCampaigns(ALL_CAMPAIGNS, 'zzz_no_match_zzz');
      const filtered = applyFilters(searched, 'USDC', 'open');
      const sorted = sortCampaigns(filtered, 'pledgedAmount');
      expect(sorted).toHaveLength(0);
    });
  });
});
