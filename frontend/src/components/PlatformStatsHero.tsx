import { useCallback, useEffect, useRef, useState } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import { getPlatformStats } from '../services/api';
import { PlatformStats } from '../types/campaign';
import {
  computeSuccessRate,
  formatSuccessRate,
  isPlatformStatsEmpty,
} from '../utils/platformStats';

const STATS_REFRESH_MS = 5 * 60 * 1000;
const COUNT_UP_DURATION_MS = 1200;

const raisedFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

type StatItemProps = {
  label: string;
  displayValue: string;
  isLoading: boolean;
};

function StatItem({ label, displayValue, isLoading }: StatItemProps) {
  return (
    <article className="platform-stats-item">
      <span className="platform-stats-label">{label}</span>
      <strong
        className="platform-stats-value"
        aria-busy={isLoading}
        aria-live={isLoading ? 'off' : 'polite'}
      >
        {isLoading ? '—' : displayValue}
      </strong>
    </article>
  );
}

type AnimatedStatProps = {
  label: string;
  target: number;
  format: (value: number) => string;
  animate: boolean;
  isLoading: boolean;
};

function AnimatedStat({ label, target, format, animate, isLoading }: AnimatedStatProps) {
  const animated = useCountUp(target, animate && !isLoading, COUNT_UP_DURATION_MS);
  const displayValue = format(animated);

  return <StatItem label={label} displayValue={displayValue} isLoading={isLoading} />;
}

export function PlatformStatsHero() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [animateCounts, setAnimateCounts] = useState(true);
  const hasLoadedOnce = useRef(false);

  const loadStats = useCallback(async () => {
    try {
      const data = await getPlatformStats();
      setStats(data);
      setFetchError(null);
      if (!hasLoadedOnce.current) {
        hasLoadedOnce.current = true;
        window.setTimeout(() => {
          setAnimateCounts(false);
        }, COUNT_UP_DURATION_MS + 50);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to load platform stats.';
      setFetchError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const intervalId = window.setInterval(() => {
      void loadStats();
    }, STATS_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadStats]);

  const emptyStats: PlatformStats = {
    totalCampaigns: 0,
    openCampaigns: 0,
    fundedCampaigns: 0,
    claimedCampaigns: 0,
    failedCampaigns: 0,
    totalPledgeVolume: 0,
    uniqueContributors: 0,
  };

  const resolvedStats = stats ?? emptyStats;
  const successRate = computeSuccessRate(resolvedStats);
  const showZeroHint = !isLoading && !fetchError && isPlatformStatsEmpty(resolvedStats);

  return (
    <section
      className="platform-stats-hero animate-fade-in"
      aria-label="Campaign platform statistics"
    >
      <div className="platform-stats-header">
        <h2 className="platform-stats-title">Platform pulse</h2>
        {fetchError ? (
          <p className="platform-stats-error" role="status">
            {fetchError}
          </p>
        ) : null}
        {showZeroHint ? (
          <p className="platform-stats-zero-hint" role="status">
            Stats will populate as the first campaigns and pledges go live.
          </p>
        ) : null}
      </div>
      <div className="platform-stats-bar">
        <AnimatedStat
          label="Total Raised"
          target={resolvedStats.totalPledgeVolume}
          format={(value) => raisedFormatter.format(value)}
          animate={animateCounts}
          isLoading={isLoading}
        />
        <AnimatedStat
          label="Active Campaigns"
          target={resolvedStats.openCampaigns}
          format={(value) => integerFormatter.format(Math.round(value))}
          animate={animateCounts}
          isLoading={isLoading}
        />
        <AnimatedStat
          label="Backers"
          target={resolvedStats.uniqueContributors}
          format={(value) => integerFormatter.format(Math.round(value))}
          animate={animateCounts}
          isLoading={isLoading}
        />
        <AnimatedStat
          label="Success Rate"
          target={successRate}
          format={(value) => formatSuccessRate(value)}
          animate={animateCounts}
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}
