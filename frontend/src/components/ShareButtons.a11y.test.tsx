import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ShareButtons } from './ShareButtons';
import { runAxeAudit, THEMES, type ThemeMode } from '../test/a11yTestUtils';
import type { Campaign } from '../types/campaign';

const mockCampaign: Campaign = {
  id: '42',
  title: 'Build a Solar Farm',
  description: 'A solar energy crowdfund.',
  creator: `G${'A'.repeat(55)}`,
  assetCode: 'XLM',
  acceptedTokens: ['XLM'],
  targetAmount: 5000,
  pledgedAmount: 1200,
  deadline: Math.floor(Date.now() / 1000) + 86400,
  createdAt: Math.floor(Date.now() / 1000),
  pledges: [],
  progress: {
    status: 'open',
    percentFunded: 24,
    remainingAmount: 3800,
    hoursLeft: 24,
    pledgeCount: 3,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  metadata: {},
};

describe.each(THEMES)('ShareButtons Accessibility (%s theme)', (theme: ThemeMode) => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { origin: 'https://example.com' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ShareButtons campaign={mockCampaign} />);
    const results = await runAxeAudit(container, theme);
    expect(results).toHaveNoViolations();
  });
});
