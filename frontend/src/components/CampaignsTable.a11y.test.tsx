import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { CampaignsTable } from './CampaignsTable';
import { runAxeAudit, setupDesktopViewport, THEMES, type ThemeMode } from '../test/a11yTestUtils';

const mockCampaign = {
  id: '1',
  creator: 'GABCD1234567890123456789012345678901234567890',
  title: 'Test Campaign',
  description: 'Test description for accessibility coverage.',
  assetCode: 'USDC',
  acceptedTokens: ['USDC'],
  targetAmount: 1000,
  pledgedAmount: 500,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdAt: Math.floor(Date.now() / 1000),
  progress: {
    status: 'open' as const,
    percentFunded: 50,
    remainingAmount: 500,
    hoursLeft: 1,
    pledgeCount: 2,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
};

describe.each(THEMES)('CampaignsTable Accessibility (%s theme)', (theme: ThemeMode) => {
  beforeEach(() => {
    setupDesktopViewport();
  });

  it('has no accessibility violations in an empty state', async () => {
    const { container } = render(
      <MemoryRouter>
        <CampaignsTable campaigns={[]} selectedCampaignId={null} onSelect={() => {}} />
      </MemoryRouter>,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });

  it('has no accessibility violations with campaign data', async () => {
    const { container } = render(
      <MemoryRouter>
        <CampaignsTable
          campaigns={[mockCampaign]}
          selectedCampaignId={null}
          onSelect={() => {}}
        />
      </MemoryRouter>,
    );

    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
