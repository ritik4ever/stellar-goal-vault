import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShareButtons } from './ShareButtons';
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

describe('ShareButtons', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { origin: 'https://example.com' },
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders all four share controls', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    expect(screen.getByRole('link', { name: /share.*twitter/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /share.*farcaster/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /share.*lens/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy campaign link/i })).toBeInTheDocument();
  });

  it('Twitter link points to twitter.com intent with campaign title, goal, and URL', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    const link = screen.getByRole('link', { name: /share.*twitter/i }) as HTMLAnchorElement;
    const url = new URL(link.href);

    expect(url.hostname).toBe('twitter.com');
    expect(url.pathname).toBe('/intent/tweet');

    const text = url.searchParams.get('text') ?? '';
    expect(text).toContain('Build a Solar Farm');
    expect(text).toContain('5000');
    expect(text).toContain('XLM');

    const tweetUrl = url.searchParams.get('url') ?? '';
    expect(tweetUrl).toBe('https://example.com/campaigns/42');
  });

  it('Farcaster link points to warpcast.com with campaign details', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    const link = screen.getByRole('link', { name: /share.*farcaster/i }) as HTMLAnchorElement;
    const url = new URL(link.href);

    expect(url.hostname).toBe('warpcast.com');

    const text = url.searchParams.get('text') ?? '';
    expect(text).toContain('Build a Solar Farm');
    expect(text).toContain('5000');
    expect(text).toContain('XLM');
    expect(text).toContain('https://example.com/campaigns/42');
  });

  it('Lens link points to hey.xyz with campaign details', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    const link = screen.getByRole('link', { name: /share.*lens/i }) as HTMLAnchorElement;
    const url = new URL(link.href);

    expect(url.hostname).toBe('hey.xyz');

    const content = url.searchParams.get('content') ?? '';
    expect(content).toContain('Build a Solar Farm');
    expect(content).toContain('5000');
    expect(content).toContain('XLM');
    expect(content).toContain('https://example.com/campaigns/42');
  });

  it('external links open in a new tab with rel=noopener noreferrer', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    for (const name of [/share.*twitter/i, /share.*farcaster/i, /share.*lens/i]) {
      const link = screen.getByRole('link', { name }) as HTMLAnchorElement;
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('copy button copies canonical campaign URL to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<ShareButtons campaign={mockCampaign} />);

    const btn = screen.getByRole('button', { name: /copy campaign link/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(writeText).toHaveBeenCalledWith('https://example.com/campaigns/42');
  });

  it('copy button shows "Copied" feedback after click, then reverts after 2 s', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<ShareButtons campaign={mockCampaign} />);

    const btn = screen.getByRole('button', { name: /copy campaign link/i });

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(btn).toHaveTextContent('Copied');

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(btn).toHaveTextContent('Copy link');
  });

  it('copy button falls back to execCommand when clipboard API is unavailable', async () => {
    // Remove clipboard API to trigger the fallback
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    // jsdom does not implement execCommand — stub it
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(true),
      writable: true,
      configurable: true,
    });

    render(<ShareButtons campaign={mockCampaign} />);

    const btn = screen.getByRole('button', { name: /copy campaign link/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('share group has an accessible group label', () => {
    render(<ShareButtons campaign={mockCampaign} />);
    expect(screen.getByRole('group', { name: /share campaign/i })).toBeInTheDocument();
  });

  it('each button and link has a descriptive aria-label', () => {
    render(<ShareButtons campaign={mockCampaign} />);

    expect(
      screen.getByRole('link', { name: 'Share "Build a Solar Farm" on Twitter' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Share "Build a Solar Farm" on Farcaster' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Share "Build a Solar Farm" on Lens' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy campaign link' })).toBeInTheDocument();
  });
});
