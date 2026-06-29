import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

function createMatchMedia(matches: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('prefers-reduced-motion', () => {
  describe('when reduced motion is preferred', () => {
    beforeEach(() => {
      window.matchMedia = createMatchMedia(true);
      vi.resetModules();
    });

    it('FundedConfetti returns null and calls onComplete immediately', async () => {
      const { FundedConfetti } = await import('./FundedConfetti');
      const onComplete = vi.fn();
      const { container } = render(
        <FundedConfetti campaignTitle="Test" onComplete={onComplete} />,
      );
      expect(container.firstChild).toBeNull();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('SkeletonCard does not have animate-pulse class', async () => {
      const { SkeletonCard } = await import('./SkeletonCard');
      const { container } = render(<SkeletonCard />);
      const article = container.querySelector('article');
      expect(article).not.toHaveClass('animate-pulse');
    });
  });

  describe('when motion is not reduced', () => {
    beforeEach(() => {
      window.matchMedia = createMatchMedia(false);
      vi.resetModules();
    });

    it('FundedConfetti renders confetti overlay', async () => {
      const { FundedConfetti } = await import('./FundedConfetti');
      const onComplete = vi.fn();
      render(<FundedConfetti campaignTitle="Orbit Fund" onComplete={onComplete} />);
      expect(screen.getByTestId('funded-confetti')).toBeInTheDocument();
    });

    it('SkeletonCard has animate-pulse class', async () => {
      const { SkeletonCard } = await import('./SkeletonCard');
      const { container } = render(<SkeletonCard />);
      const article = container.querySelector('article');
      expect(article).toHaveClass('animate-pulse');
    });
  });
});
