import { PlatformStats } from '../types/campaign';

export function computeSuccessRate(stats: PlatformStats): number {
  if (stats.totalCampaigns <= 0) {
    return 0;
  }
  return ((stats.fundedCampaigns + stats.claimedCampaigns) / stats.totalCampaigns) * 100;
}

export function formatSuccessRate(rate: number): string {
  const rounded = rate < 10 ? rate.toFixed(1) : Math.round(rate).toString();
  return `${rounded}%`;
}

export function isPlatformStatsEmpty(stats: PlatformStats): boolean {
  return (
    stats.totalCampaigns === 0 &&
    stats.totalPledgeVolume === 0 &&
    stats.uniqueContributors === 0
  );
}
