import React, { useMemo } from 'react';
import { Campaign } from '../types/campaign';

interface CreatorAnalyticsProps {
  creatorAddress: string;
  campaigns: Campaign[];
  isLoading?: boolean;
}

export const CreatorAnalytics: React.FC<CreatorAnalyticsProps> = ({
  creatorAddress,
  campaigns,
  isLoading = false,
}) => {
  const metrics = useMemo(() => {
    if (!creatorAddress || !campaigns.length) {
      return {
        campaignsCreated: 0,
        fundedCampaigns: 0,
        claimedVaults: 0,
      };
    }

    const creatorCampaigns = campaigns.filter(
      (c) => c.creator.toLowerCase() === creatorAddress.toLowerCase()
    );

    const fundedCampaigns = creatorCampaigns.filter(
      (c) => c.progress.status === 'funded'
    ).length;

    const claimedVaults = creatorCampaigns.filter(
      (c) => c.progress.status === 'claimed'
    ).length;

    return {
      campaignsCreated: creatorCampaigns.length,
      fundedCampaigns,
      claimedVaults,
    };
  }, [creatorAddress, campaigns]);

  if (isLoading) {
    return (
      <div className="creator-metrics-container">
        <h3 className="creator-metrics-title">Creator Performance</h3>
        <div className="metric-grid">
          <div className="metric-card">
            <span>Campaigns Created</span>
            <strong>—</strong>
          </div>
          <div className="metric-card">
            <span>Funded Campaigns</span>
            <strong>—</strong>
          </div>
          <div className="metric-card">
            <span>Claimed Vaults</span>
            <strong>—</strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="creator-metrics-container">
      <h3 className="creator-metrics-title">
        Creator Performance: <code className="creator-address">{creatorAddress}</code>
      </h3>
      <div className="metric-grid">
        <div className="metric-card animate-fade-in">
          <span>Campaigns Created</span>
          <strong>{metrics.campaignsCreated}</strong>
        </div>
        <div className="metric-card animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <span>Funded Campaigns</span>
          <strong>{metrics.fundedCampaigns}</strong>
        </div>
        <div className="metric-card animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <span>Claimed Vaults</span>
          <strong>{metrics.claimedVaults}</strong>
        </div>
      </div>
    </div>
  );
};
