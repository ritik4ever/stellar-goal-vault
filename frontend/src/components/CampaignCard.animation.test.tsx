import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { CampaignCard } from './CampaignCard';
import { Campaign } from '../types/campaign';

const baseCampaign: Campaign = {
  id: '123',
  title: 'Test Campaign',
  description: 'Test',
  creator: 'G'.repeat(56),
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
    remainingAmount: 500,
    pledgeCount: 5,
    hoursLeft: 24,
  },
  pledges: [],
  assetIssuer: 'G'.repeat(56),
  acceptedTokens: [],
  metadata: null,
};

function renderCard(campaign: Campaign) {
  return render(<CampaignCard campaign={campaign} selectedCampaignId={null} onSelect={() => {}} />);
}

function getFillElement() {
  return document.querySelector<HTMLElement>('.campaign-card .progress-bar > div');
}

describe('CampaignCard progress bar animation', () => {
  it('does not apply the animation class on initial page load', () => {
    renderCard(baseCampaign);

    const fill = getFillElement();
    expect(fill).not.toBeNull();
    expect(fill).not.toHaveClass('progress-bar-fill');
    expect(fill).toHaveStyle({ width: '50%' });
  });

  it('applies the animation class in the same commit as the width change', () => {
    const { rerender } = renderCard(baseCampaign);

    const updated = {
      ...baseCampaign,
      pledgedAmount: 750,
      progress: { ...baseCampaign.progress, percentFunded: 75 },
    };
    rerender(<CampaignCard campaign={updated} selectedCampaignId={null} onSelect={() => {}} />);

    const fill = getFillElement();
    expect(fill).toHaveClass('progress-bar-fill');
    expect(fill).toHaveStyle({ width: '75%' });
  });

  it('re-arms the animation for subsequent funding changes', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = renderCard(baseCampaign);

      rerender(
        <CampaignCard
          campaign={{
            ...baseCampaign,
            pledgedAmount: 750,
            progress: { ...baseCampaign.progress, percentFunded: 75 },
          }}
          selectedCampaignId={null}
          onSelect={() => {}}
        />,
      );
      expect(getFillElement()).toHaveClass('progress-bar-fill');

      // After the transition window the class is dropped so the next
      // change can trigger the transition again.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(getFillElement()).not.toHaveClass('progress-bar-fill');

      rerender(
        <CampaignCard
          campaign={{
            ...baseCampaign,
            pledgedAmount: 900,
            progress: { ...baseCampaign.progress, percentFunded: 90 },
          }}
          selectedCampaignId={null}
          onSelect={() => {}}
        />,
      );
      expect(getFillElement()).toHaveClass('progress-bar-fill');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not animate when selection changes but funding percentage stays equal', () => {
    const { rerender } = renderCard(baseCampaign);

    rerender(
      <CampaignCard
        campaign={{ ...baseCampaign, pledgedAmount: 500 }}
        selectedCampaignId="other"
        onSelect={() => {}}
      />,
    );

    expect(getFillElement()).not.toHaveClass('progress-bar-fill');
  });

  it('defines a sub-half-second transition on .progress-bar-fill for responsiveness', () => {
    // Vitest stubs CSS imports in jsdom, so assert on the stylesheet source.
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');
    const match = css.match(/\.progress-bar-fill\s*\{[^}]*\}/);
    expect(match).not.toBeNull();

    const transition = match![0];
    expect(transition).toContain('transition:');
    expect(transition).toContain('width');
    expect(transition).toContain('0.4s');
  });
});
