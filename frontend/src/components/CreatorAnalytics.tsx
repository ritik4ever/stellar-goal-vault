import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
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
  const { metrics, statusData, pledgeData } = useMemo(() => {
    if (!creatorAddress || !campaigns.length) {
      return {
        metrics: {
          campaignsCreated: 0,
          fundedCampaigns: 0,
          claimedVaults: 0,
        },
        statusData: [],
        pledgeData: [],
      };
    }

    const creatorCampaigns = campaigns.filter(
      (c) => c.creator.toLowerCase() === creatorAddress.toLowerCase(),
    );

    const fundedCampaigns = creatorCampaigns.filter((c) => c.progress.status === 'funded').length;
    const claimedVaults = creatorCampaigns.filter((c) => c.progress.status === 'claimed').length;
    const openCampaigns = creatorCampaigns.filter((c) => c.progress.status === 'open').length;
    const failedCampaigns = creatorCampaigns.filter((c) => c.progress.status === 'failed').length;

    const statusChartData = [
      { status: 'Open', count: openCampaigns },
      { status: 'Funded', count: fundedCampaigns },
      { status: 'Claimed', count: claimedVaults },
      { status: 'Failed', count: failedCampaigns },
    ];

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const pledgesByDay: Record<string, number> = {};

    creatorCampaigns.forEach((campaign) => {
      campaign.pledges?.forEach((pledge) => {
        if (pledge.createdAt >= thirtyDaysAgo) {
          const date = new Date(pledge.createdAt * 1000).toLocaleDateString();
          pledgesByDay[date] = (pledgesByDay[date] || 0) + pledge.amount;
        }
      });
    });

    const pledgeChartData = Object.entries(pledgesByDay)
      .map(([date, amount]) => ({ date, volume: amount }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      metrics: {
        campaignsCreated: creatorCampaigns.length,
        fundedCampaigns,
        claimedVaults,
      },
      statusData: statusChartData,
      pledgeData: pledgeChartData,
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

  const hasChartData = pledgeData.length > 0;

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

      {metrics.campaignsCreated > 0 && (
        <div style={{ marginTop: 32 }}>
          <h4 style={{ marginBottom: 16 }}>Campaign Status Distribution</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={statusData} aria-label="Bar chart showing campaign count per status">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="status"
                aria-hidden="true"
              />
              <YAxis aria-hidden="true" />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="count"
                fill="#8884d8"
                name="Campaign Count"
                aria-label="Campaign count"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasChartData && (
        <div style={{ marginTop: 32 }}>
          <h4 style={{ marginBottom: 16 }}>Pledge Volume (Last 30 Days)</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={pledgeData}
              aria-label="Line chart showing pledge volume over the last 30 days"
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                aria-hidden="true"
              />
              <YAxis aria-hidden="true" />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="volume"
                stroke="#82ca9d"
                name="Pledge Volume"
                aria-label="Pledge volume"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
