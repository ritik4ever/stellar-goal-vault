import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContributorSummary as ContributorSummaryRow } from '../types/campaign';
import { ContributorSummary } from './ContributorSummary';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

// The component fetches its own contributor rows from
// GET /campaigns/:id/contributors, so the API is mocked instead of passing
// pledges in as a prop.
const mockApi = vi.hoisted(() => ({ rows: [] as ContributorSummaryRow[] }));

vi.mock('../services/httpClient', () => ({
  apiRequest: vi.fn(async () => ({ data: mockApi.rows })),
}));

const sampleContributors: ContributorSummaryRow[] = [
  {
    contributor: 'GABCD1234567890123456789012345678901234567890',
    totalPledged: 25,
    refundedAmount: 0,
    isFullyRefunded: false,
  },
  {
    contributor: 'GEFGH1234567890123456789012345678901234567890',
    totalPledged: 10,
    refundedAmount: 10,
    isFullyRefunded: true,
  },
];

const partiallyRefundedContributors: ContributorSummaryRow[] = [
  {
    contributor: 'GHIJK1234567890123456789012345678901234567890',
    totalPledged: 15,
    refundedAmount: 5,
    isFullyRefunded: false,
  },
];

describe.each(THEMES)('ContributorSummary Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations with contributor data', async () => {
    mockApi.rows = sampleContributors;
    const { container } = render(<ContributorSummary assetCode="USDC" campaignId="1" />);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations in empty state', async () => {
    mockApi.rows = [];
    const { container } = render(<ContributorSummary assetCode="USDC" campaignId="1" />);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with pending pledge badge', async () => {
    mockApi.rows = partiallyRefundedContributors;
    const { container } = render(<ContributorSummary assetCode="USDC" campaignId="1" />);

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
