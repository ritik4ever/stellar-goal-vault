import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { ArrowLeft, TrendingUp, Users, Target, Activity, ShieldAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { CampaignAnalytics as CampaignAnalyticsType } from '../types/campaign';
import { getCampaignAnalytics } from '../services/api';
import { useFreighter } from '../hooks/useFreighter';
import { ErrorBoundary } from './ErrorBoundary';
import { AddressAvatar } from './AddressAvatar';
import CopyButton from './CopyButton';

// Theme-aware tooltip for recharts
const ChartTooltip: React.FC<TooltipProps<number, string>> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--bg-surface, rgba(15,23,42,0.95))',
        border: '1px solid var(--border-glass, rgba(255,255,255,0.1))',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        fontSize: '0.85rem',
        color: 'var(--text-main, #f8fafc)',
      }}
    >
      <p style={{ margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ margin: 0, color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
};

export const CampaignAnalytics: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const freighter = useFreighter();
  const connectedWallet = freighter.publicKey;

  const [analytics, setAnalytics] = useState<CampaignAnalyticsType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchAnalytics = useCallback(() => {
    if (!id) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getCampaignAnalytics(id)
      .then((data) => {
        if (!cancelled) {
          setAnalytics(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load analytics.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const cleanup = fetchAnalytics();
    return cleanup;
  }, [fetchAnalytics, retryCount]);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  const hasVelocityData = useMemo(
    () => (analytics?.pledgeVelocity?.length ?? 0) > 0,
    [analytics],
  );

  const hasContributorData = useMemo(
    () => (analytics?.contributorMap?.length ?? 0) > 0,
    [analytics],
  );

  const isCreator = useMemo(() => {
    if (!analytics || !connectedWallet) return null; // null = still determining
    return connectedWallet === analytics.creator;
  }, [analytics, connectedWallet]);

  // Loading state
  if (isLoading || isCreator === null) {
    return (
      <div className="analytics-page">
        <div className="analytics-container">
          <div className="analytics-header">
            <button
              className="btn-ghost analytics-back-btn"
              type="button"
              onClick={() => navigate(`/campaigns/${id}`)}
            >
              <ArrowLeft size={18} />
              Back to campaign
            </button>
            <h2 className="analytics-title">Campaign Analytics</h2>
          </div>
          <div className="analytics-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <article key={index} className="analytics-stat-card">
                <div className="skeleton skeleton-line" style={{ width: 100 }} />
                <div
                  className="skeleton skeleton-line"
                  style={{ width: 60, height: 18, marginTop: 8 }}
                />
              </article>
            ))}
          </div>
          <div className="analytics-chart-card">
            <div className="skeleton skeleton-line" style={{ width: 180, marginBottom: 16 }} />
            <div
              className="skeleton skeleton-line"
              style={{ width: '100%', height: 200, borderRadius: 12 }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="analytics-page">
        <div className="analytics-container">
          <div className="analytics-header">
            <button
              className="btn-ghost analytics-back-btn"
              type="button"
              onClick={() => navigate(`/campaigns/${id}`)}
            >
              <ArrowLeft size={18} />
              Back to campaign
            </button>
          </div>
          <div className="form-error analytics-error" role="alert">
            <p>{error}</p>
            <button
              className="btn-ghost"
              type="button"
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return null;
  }

  // Creator-only gate
  if (isCreator === false) {
    return (
      <div className="analytics-page">
        <div className="analytics-container">
          <div className="analytics-header">
            <button
              className="btn-ghost analytics-back-btn"
              type="button"
              onClick={() => navigate(`/campaigns/${id}`)}
            >
              <ArrowLeft size={18} />
              Back to campaign
            </button>
          </div>
          <div className="analytics-empty-chart" style={{ minHeight: 300 }}>
            <ShieldAlert size={48} />
            <h3>Access Restricted</h3>
            <p>
              Only the campaign creator can view analytics.{' '}
              {!connectedWallet && 'Connect your Freighter wallet to verify ownership.'}
            </p>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => navigate(`/campaigns/${id}`)}
            >
              Return to campaign
            </button>
          </div>
        </div>
      </div>
    );
  }

  const fundingPaceData = analytics.fundingPace.length > 0
    ? analytics.fundingPace
    : analytics.pledgedAmount > 0
      ? [
          {
            date: new Date().toISOString().slice(0, 10),
            cumulativePercent: analytics.percentFunded,
          },
        ]
      : [];

  return (
    <ErrorBoundary componentName="CampaignAnalytics">
      <div className="analytics-page">
        <div className="analytics-container">
          <div className="analytics-header">
            <button
              className="btn-ghost analytics-back-btn"
              type="button"
              onClick={() => navigate(`/campaigns/${id}`)}
            >
              <ArrowLeft size={18} />
              Back to campaign
            </button>
            <div>
              <h2 className="analytics-title">{analytics.title}</h2>
              <p className="analytics-subtitle">
                Creator:{' '}
                <span className="analytics-creator">
                  <AddressAvatar address={analytics.creator} size={18} />
                  <code className="mono">{analytics.creator.slice(0, 16)}...</code>
                  <CopyButton value={analytics.creator} ariaLabel="Copy creator address" />
                </span>
              </p>
            </div>
          </div>

          {/* Summary stat cards */}
          <div className="analytics-grid">
            <article className="analytics-stat-card">
              <span className="analytics-stat-icon">
                <Target size={20} />
              </span>
              <div>
                <span className="analytics-stat-label">Funding Progress</span>
                <strong>{analytics.percentFunded}%</strong>
                <span className="analytics-stat-hint">
                  {analytics.pledgedAmount} / {analytics.targetAmount}
                </span>
              </div>
            </article>
            <article className="analytics-stat-card">
              <span className="analytics-stat-icon">
                <Activity size={20} />
              </span>
              <div>
                <span className="analytics-stat-label">Total Pledges</span>
                <strong>{analytics.totalPledges}</strong>
              </div>
            </article>
            <article className="analytics-stat-card">
              <span className="analytics-stat-icon">
                <Users size={20} />
              </span>
              <div>
                <span className="analytics-stat-label">Unique Contributors</span>
                <strong>{analytics.totalContributors}</strong>
              </div>
            </article>
            <article className="analytics-stat-card">
              <span className="analytics-stat-icon">
                <TrendingUp size={20} />
              </span>
              <div>
                <span className="analytics-stat-label">Velocity (daily avg)</span>
                <strong>
                  {hasVelocityData
                    ? (
                        analytics.pledgeVelocity.reduce(
                          (sum, v) => sum + v.amount,
                          0,
                        ) / analytics.pledgeVelocity.length
                      ).toFixed(1)
                    : '0'}
                </strong>
              </div>
            </article>
          </div>

          {/* Chart panels */}
          <div className="analytics-charts-grid">
            {/* Pledge Velocity Chart */}
            <div className="analytics-chart-card">
              <h3 className="analytics-chart-title">Pledge Velocity</h3>
              {hasVelocityData ? (
                <div className="analytics-chart-wrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={analytics.pledgeVelocity}
                      aria-label="Line chart showing daily pledge amounts"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass, rgba(255,255,255,0.1))" />
                      <XAxis
                        dataKey="date"
                        aria-hidden="true"
                        tick={{ fontSize: 12, fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <YAxis
                        aria-hidden="true"
                        tick={{ fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: 'var(--text-main, #f8fafc)' }} />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        stroke="#6366f1"
                        name="Pledge Amount"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="analytics-empty-chart">
                  <Activity size={40} />
                  <p>
                    {analytics.totalPledges === 0
                      ? 'No pledges yet. Pledge velocity will appear here once contributions begin.'
                      : 'Insufficient pledge data to display velocity chart.'}
                  </p>
                </div>
              )}
            </div>

            {/* Contributor Map */}
            <div className="analytics-chart-card">
              <h3 className="analytics-chart-title">Contributor Activity</h3>
              {hasContributorData ? (
                <div className="analytics-chart-wrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={analytics.contributorMap}
                      aria-label="Bar chart showing contributor count per day"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass, rgba(255,255,255,0.1))" />
                      <XAxis
                        dataKey="date"
                        aria-hidden="true"
                        tick={{ fontSize: 12, fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <YAxis
                        aria-hidden="true"
                        tick={{ fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: 'var(--text-main, #f8fafc)' }} />
                      <Bar
                        dataKey="count"
                        fill="#a855f7"
                        name="Contributors"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="analytics-empty-chart">
                  <Users size={40} />
                  <p>
                    {analytics.totalContributors === 0
                      ? 'No contributors yet. Activity will be tracked here.'
                      : 'Insufficient data to display contributor activity chart.'}
                  </p>
                </div>
              )}
            </div>

            {/* Funding Pace Indicator */}
            <div className="analytics-chart-card">
              <h3 className="analytics-chart-title">Funding Pace</h3>
              {fundingPaceData.length > 0 ? (
                <div className="analytics-chart-wrap">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={fundingPaceData}
                      aria-label="Line chart showing cumulative funding percentage over time"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-glass, rgba(255,255,255,0.1))" />
                      <XAxis
                        dataKey="date"
                        aria-hidden="true"
                        tick={{ fontSize: 12, fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <YAxis
                        aria-hidden="true"
                        domain={[0, 100]}
                        tickFormatter={(v: number) => `${v}%`}
                        tick={{ fill: 'var(--text-muted, #94a3b8)' }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ color: 'var(--text-main, #f8fafc)' }} />
                      <Line
                        type="monotone"
                        dataKey="cumulativePercent"
                        stroke="#22c55e"
                        name="Funding %"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="analytics-empty-chart">
                  <TrendingUp size={40} />
                  <p>No funding pace data available yet.</p>
                </div>
              )}
            </div>

            {/* Top Contributors */}
            <div className="analytics-chart-card">
              <h3 className="analytics-chart-title">Top Contributors</h3>
              {analytics.topContributors.length > 0 ? (
                <div className="analytics-contributors-list">
                  <div className="analytics-contributors-header">
                    <span>Contributor</span>
                    <span>Total Pledged</span>
                  </div>
                  {analytics.topContributors.map((contributor, index) => (
                    <div key={contributor.contributor} className="analytics-contributor-row">
                      <span className="analytics-contributor-rank">#{index + 1}</span>
                      <span className="analytics-contributor-address">
                        <AddressAvatar address={contributor.contributor} size={20} />
                        <code className="mono">
                          {contributor.contributor.slice(0, 10)}...
                          {contributor.contributor.slice(-6)}
                        </code>
                      </span>
                      <strong className="analytics-contributor-amount">
                        {contributor.totalPledged}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="analytics-empty-chart">
                  <Users size={40} />
                  <p>No contributors yet. The top contributors list will appear here once pledges are made.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default CampaignAnalytics;
