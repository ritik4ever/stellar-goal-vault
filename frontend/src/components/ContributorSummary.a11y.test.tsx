import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pledge } from '../types/campaign';
import { ContributorSummary } from './ContributorSummary';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';

const samplePledges: Pledge[] = [
  {
    id: 1,
    campaignId: '1',
    contributor: 'GABCD1234567890123456789012345678901234567890',
    amount: 25,
    assetCode: 'USDC',
    createdAt: Math.floor(Date.now() / 1000),
  },
  {
    id: 2,
    campaignId: '1',
    contributor: 'GEFGH1234567890123456789012345678901234567890',
    amount: 10,
    assetCode: 'USDC',
    createdAt: Math.floor(Date.now() / 1000),
    refundedAt: Math.floor(Date.now() / 1000),
  },
];

describe.each(THEMES)('ContributorSummary Accessibility (%s theme)', (theme: ThemeMode) => {
  it('has no accessibility violations with contributor data', async () => {
    const { container } = render(
      <ContributorSummary pledges={samplePledges} assetCode="USDC" campaignId="1" />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations in empty state', async () => {
    const { container } = render(
      <ContributorSummary pledges={[]} assetCode="USDC" campaignId="1" />,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
