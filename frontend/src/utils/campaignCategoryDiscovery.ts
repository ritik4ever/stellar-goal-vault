export type CampaignCategory =
  | 'education'
  | 'sustainability'
  | 'open-source'
  | 'healthcare'
  | 'community';

export interface DiscoverableCampaign {
  id: string;
  title: string;
  description: string;
  category: CampaignCategory;
  status: 'active' | 'completed' | 'expired';
  pledgedAmount: number;
  targetAmount: number;
}

export function computeCategoryFacetCounts(
  campaigns: DiscoverableCampaign[],
): Record<CampaignCategory, number> {
  const counts: Record<CampaignCategory, number> = {
    education: 0,
    sustainability: 0,
    'open-source': 0,
    healthcare: 0,
    community: 0,
  };
  for (const c of campaigns) {
    if (c.category in counts) {
      counts[c.category] += 1;
    }
  }
  return counts;
}

export function filterDiscoverableCampaigns(
  campaigns: DiscoverableCampaign[],
  options: { category?: CampaignCategory | 'all'; query?: string; onlyActive?: boolean },
): DiscoverableCampaign[] {
  const category = options.category ?? 'all';
  const q = String(options.query ?? '').trim().toLowerCase();
  const onlyActive = Boolean(options.onlyActive);

  return campaigns.filter((c) => {
    if (onlyActive && c.status !== 'active') {
      return false;
    }
    if (category !== 'all' && c.category !== category) {
      return false;
    }
    if (q.length > 0) {
      const hay = `${c.title} ${c.description}`.toLowerCase();
      if (!hay.includes(q)) {
        return false;
      }
    }
    return true;
  });
}
