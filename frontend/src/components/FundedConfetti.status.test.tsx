import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { FundedConfetti } from './FundedConfetti';
import { didCampaignBecomeFunded } from '../lib/fundingCelebration';
import { Campaign } from '../types/campaign';

describe('FundedConfetti status transition', () => {
  it('fires exactly once when campaign status changes from open to funded', () => {
    const openCampaign: Campaign = {
      id: '123',
      title: 'Test Campaign',
      description: 'Test',
      creator: 'G...',
      assetCode: 'USDC',
      deadline: Date.now() / 1000 + 86400,
      createdAt: Date.now() / 1000,
      pledgedAmount: 500,
      targetAmount: 1000,
      progress: {
        status: 'open',
        percentFunded: 50,
        canPledge: true,
        canClaim: false,
        canRefund: false,
        remainingAmount: '500',
        pledgeCount: 5,
      },
      pledges: [],
      assetIssuer: 'G...',
      acceptedTokens: [],
      metadata: null,
    };

    const fundedCampaign: Campaign = {
      ...openCampaign,
      progress: {
        ...openCampaign.progress,
        status: 'funded',
        percentFunded: 100,
        canClaim: true,
        canPledge: false,
        remainingAmount: '0',
      },
    };

    const transitioned = didCampaignBecomeFunded(openCampaign, fundedCampaign);
    expect(transitioned).toBe(true);
  });

  it('does not fire when already funded', () => {
    const fundedCampaign: Campaign = {
      id: '123',
      title: 'Test Campaign',
      description: 'Test',
      creator: 'G...',
      assetCode: 'USDC',
      deadline: Date.now() / 1000 + 86400,
      createdAt: Date.now() / 1000,
      pledgedAmount: 1000,
      targetAmount: 1000,
      progress: {
        status: 'funded',
        percentFunded: 100,
        canPledge: false,
        canClaim: true,
        canRefund: false,
        remainingAmount: '0',
        pledgeCount: 10,
      },
      pledges: [],
      assetIssuer: 'G...',
      acceptedTokens: [],
      metadata: null,
    };

    const stillFunded: Campaign = {
      ...fundedCampaign,
      pledgedAmount: 1000,
    };

    const transitioned = didCampaignBecomeFunded(fundedCampaign, stillFunded);
    expect(transitioned).toBe(false);
  });

  it('does not fire on page load when campaign is already funded', () => {
    const fundedCampaign: Campaign = {
      id: '123',
      title: 'Test Campaign',
      description: 'Test',
      creator: 'G...',
      assetCode: 'USDC',
      deadline: Date.now() / 1000 + 86400,
      createdAt: Date.now() / 1000,
      pledgedAmount: 1000,
      targetAmount: 1000,
      progress: {
        status: 'funded',
        percentFunded: 100,
        canPledge: false,
        canClaim: true,
        canRefund: false,
        remainingAmount: '0',
        pledgeCount: 10,
      },
      pledges: [],
      assetIssuer: 'G...',
      acceptedTokens: [],
      metadata: null,
    };

    const transitioned = didCampaignBecomeFunded(null, fundedCampaign);
    expect(transitioned).toBe(false);
  });

  it('renders confetti component with correct campaign title', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(
      <FundedConfetti
        campaignTitle="Orbit Fund"
        onComplete={onComplete}
      />
    );

    expect(screen.getByTestId('funded-confetti')).toBeInTheDocument();
    expect(screen.getByTestId('funded-confetti')).toHaveAttribute(
      'title',
      'Orbit Fund reached its funding target'
    );

    vi.advanceTimersByTime(1400);
    expect(onComplete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
