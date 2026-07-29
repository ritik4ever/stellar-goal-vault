import { useCallback, useEffect, useRef, useState } from 'react';
import { Campaign } from '../types/campaign';
import { listCampaigns } from '../services/api';

const TRENDING_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const TRENDING_LIMIT = 5;

export function useTrendingCampaigns() {
  const [trendingCampaigns, setTrendingCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const calculatePledgeVelocity = useCallback((campaign: Campaign): number => {
    if (!campaign.pledges || campaign.pledges.length === 0) {
      return 0;
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - TWENTY_FOUR_HOURS;

    const recentPledges = campaign.pledges.filter((pledge) => {
      const pledgeTime = pledge.createdAt * 1000;
      return pledgeTime >= twentyFourHoursAgo && !pledge.refundedAt;
    });

    return recentPledges.reduce((sum, pledge) => sum + pledge.amount, 0);
  }, []);

  const fetchTrendingCampaigns = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await listCampaigns({
        status: 'open',
        limit: 50,
        sort: 'pledgedAmount',
        order: 'desc',
      });

      const openCampaigns = response.data.filter(
        (campaign) => campaign.progress.status === 'open' && !campaign.deletedAt
      );

      const campaignsWithVelocity = openCampaigns.map((campaign) => ({
        campaign,
        velocity: calculatePledgeVelocity(campaign),
      }));

      campaignsWithVelocity.sort((a, b) => b.velocity - a.velocity);

      const trending = campaignsWithVelocity
        .slice(0, TRENDING_LIMIT)
        .map((item) => item.campaign);

      setTrendingCampaigns(trending);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load trending campaigns';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [calculatePledgeVelocity]);

  useEffect(() => {
    void fetchTrendingCampaigns();

    intervalRef.current = setInterval(() => {
      void fetchTrendingCampaigns();
    }, TRENDING_REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchTrendingCampaigns]);

  const refresh = useCallback(() => {
    void fetchTrendingCampaigns();
  }, [fetchTrendingCampaigns]);

  return {
    trendingCampaigns,
    isLoading,
    error,
    refresh,
  };
}
