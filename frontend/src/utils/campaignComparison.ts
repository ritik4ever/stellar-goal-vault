export const MAX_COMPARED_CAMPAIGNS = 3;

export interface ComparableCampaign {
  id: string;
  title: string;
  targetAmount: number;
  pledgedAmount: number;
  contributorsCount: number;
  deadlineIso: string;
}

export interface CampaignComparisonRow {
  id: string;
  title: string;
  percentFunded: number;
  averageContribution: number;
  remainingAmount: number;
  isHighestFundedPct: boolean;
  isLowestRemainingAmount: boolean;
}

export function toggleComparedCampaignId(currentIds: string[], candidateId: string): {
  ids: string[];
  limitReached: boolean;
} {
  const cleanId = String(candidateId || '').trim();
  if (!cleanId) {
    return { ids: [...currentIds], limitReached: false };
  }
  if (currentIds.includes(cleanId)) {
    return { ids: currentIds.filter((id) => id !== cleanId), limitReached: false };
  }
  if (currentIds.length >= MAX_COMPARED_CAMPAIGNS) {
    return { ids: [...currentIds], limitReached: true };
  }
  return { ids: [...currentIds, cleanId], limitReached: false };
}

export function buildCampaignComparisonMatrix(campaigns: ComparableCampaign[]): CampaignComparisonRow[] {
  const bounded = campaigns.slice(0, MAX_COMPARED_CAMPAIGNS);
  if (bounded.length === 0) {
    return [];
  }
  const metrics = bounded.map((c) => {
    const target = Math.max(0, Number(c.targetAmount) || 0);
    const pledged = Math.max(0, Number(c.pledgedAmount) || 0);
    const contributors = Math.max(0, Math.floor(Number(c.contributorsCount) || 0));
    const percentFunded = target > 0 ? Math.round((pledged / target) * 1000) / 10 : 0;
    const averageContribution = contributors > 0 ? Math.round((pledged / contributors) * 100) / 100 : 0;
    const remainingAmount = Math.max(0, Math.round((target - pledged) * 100) / 100);
    return {
      id: c.id,
      title: c.title,
      percentFunded,
      averageContribution,
      remainingAmount,
    };
  });

  const maxPct = Math.max(...metrics.map((m) => m.percentFunded));
  const minRem = Math.min(...metrics.map((m) => m.remainingAmount));

  return metrics.map((m) => ({
    ...m,
    isHighestFundedPct: m.percentFunded === maxPct,
    isLowestRemainingAmount: m.remainingAmount === minRem,
  }));
}
