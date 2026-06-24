import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignsTable } from './CampaignsTable';
import type { Campaign } from '../types/campaign';

vi.mock('../hooks/useMediaQuery', () => ({
  useMediaQuery: () => false,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useWindowVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: () => undefined,
  }),
}));

const mockCampaign = (id: string): Campaign => ({
  id,
  creator: `G${'A'.repeat(55)}`,
  title: `Campaign ${id}`,
  description: 'A campaign used for infinite scroll testing in the dashboard.',
  assetCode: 'USDC',
  acceptedTokens: ['USDC'],
  targetAmount: 100,
  pledgedAmount: 10,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdAt: Math.floor(Date.now() / 1000),
  progress: {
    status: 'open',
    percentFunded: 10,
    hoursLeft: 24,
    canClaim: false,
    canRefund: false,
  },
});

describe('CampaignsTable infinite scroll', () => {
  let observe: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    observe = vi.fn();
    disconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  it('triggers onLoadMore when the sentinel becomes visible', async () => {
    const onLoadMore = vi.fn();
    const campaigns = Array.from({ length: 20 }, (_, index) => mockCampaign(String(index + 1)));

    render(
      <CampaignsTable
        campaigns={campaigns}
        selectedCampaignId={null}
        onSelect={() => undefined}
        onLoadMore={onLoadMore}
        hasMore
      />,
    );

    expect(observe).toHaveBeenCalled();

    intersectionCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

    await waitFor(() => {
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a loading indicator while the next page is loading', () => {
    render(
      <CampaignsTable
        campaigns={[mockCampaign('1')]}
        selectedCampaignId={null}
        onSelect={() => undefined}
        hasMore
        isLoadingMore
      />,
    );

    expect(screen.getByText('Loading more campaigns...')).toBeInTheDocument();
  });

  it('shows an end-of-list message when there are no more pages', () => {
    render(
      <CampaignsTable
        campaigns={[mockCampaign('1')]}
        selectedCampaignId={null}
        onSelect={() => undefined}
        hasMore={false}
      />,
    );

    expect(screen.getByText('You have reached the end of the campaign list.')).toBeInTheDocument();
  });
});
