import {
  computeCategoryFacetCounts,
  DiscoverableCampaign,
  filterDiscoverableCampaigns,
} from './campaignCategoryDiscovery';

describe('campaignCategoryDiscovery (#589)', () => {
  const sample: DiscoverableCampaign[] = [
    {
      id: '1',
      title: 'Soroban Developer Bootcamp',
      description: 'Hands-on smart contract workshops',
      category: 'education',
      status: 'active',
      pledgedAmount: 1200,
      targetAmount: 2000,
    },
    {
      id: '2',
      title: 'Mangrove Carbon Vault',
      description: 'Coastal restoration on Stellar',
      category: 'sustainability',
      status: 'active',
      pledgedAmount: 3000,
      targetAmount: 3000,
    },
    {
      id: '3',
      title: 'Open Indexer SDK',
      description: 'TypeScript SDK for Soroban events',
      category: 'open-source',
      status: 'completed',
      pledgedAmount: 5000,
      targetAmount: 5000,
    },
  ];

  it('aggregates facet counts across all campaign categories', () => {
    const counts = computeCategoryFacetCounts(sample);
    expect(counts.education).toBe(1);
    expect(counts.sustainability).toBe(1);
    expect(counts['open-source']).toBe(1);
    expect(counts.healthcare).toBe(0);
  });

  it('filters campaigns by category, active state, and search keyword', () => {
    const activeEdu = filterDiscoverableCampaigns(sample, {
      category: 'education',
      onlyActive: true,
    });
    expect(activeEdu).toHaveLength(1);
    expect(activeEdu[0].id).toBe('1');

    const searchSoroban = filterDiscoverableCampaigns(sample, {
      category: 'all',
      query: 'soroban',
    });
    expect(searchSoroban.map((c) => c.id)).toEqual(['1', '3']);
  });
});
