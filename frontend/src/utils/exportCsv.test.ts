import { describe, it, expect } from 'vitest';
import { buildContributorCsv } from './exportCsv';
import { ContributorSummary } from '../types/campaign';

const mockContributors: ContributorSummary[] = [
  {
    contributor: 'GABC1234567890',
    totalPledged: 100,
    refundedAmount: 0,
    isFullyRefunded: false,
  },
  {
    contributor: 'GXYZ9876543210',
    totalPledged: 50,
    refundedAmount: 50,
    isFullyRefunded: true,
  },
];

describe('buildContributorCsv', () => {
  it('includes header row', () => {
    const csv = buildContributorCsv(mockContributors);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toBe('address,totalPledged,refundedAmount,isFullyRefunded');
  });

  it('produces one data row per contributor', () => {
    const csv = buildContributorCsv(mockContributors);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('encodes contributor address correctly', () => {
    const csv = buildContributorCsv(mockContributors);
    expect(csv).toContain('GABC1234567890,100,0,false');
  });

  it('encodes isFullyRefunded as true when fully refunded', () => {
    const csv = buildContributorCsv(mockContributors);
    expect(csv).toContain('GXYZ9876543210,50,50,true');
  });

  it('returns only a header row for an empty list', () => {
    const csv = buildContributorCsv([]);
    expect(csv).toBe('address,totalPledged,refundedAmount,isFullyRefunded');
  });
});
