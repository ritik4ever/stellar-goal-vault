import { useMemo } from 'react';
import { Campaign } from '../types/campaign';
import { useTrendingCampaigns } from '../hooks/useTrendingCampaigns';
import AddressAvatar from './AddressAvatar';

interface TrendingCampaignsProps {
  onSelect: (campaignId: string) => void;
  selectedCampaignId: string | null;
}

function formatTimeRemaining(hoursLeft: number): string {
  if (hoursLeft <= 0) {
    return 'Ended';
  }

  if (hoursLeft < 24) {
    const hours = Math.floor(hoursLeft);
    return `${hours}h left`;
  }

  const days = Math.floor(hoursLeft / 24);
  const remainingHours = Math.floor(hoursLeft % 24);

  if (remainingHours === 0) {
    return `${days}d left`;
  }

  return `${days}d ${remainingHours}h left`;
}

function TrendingCard({
  campaign,
  isSelected,
  onSelect,
}: {
  campaign: Campaign;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const percentFunded = useMemo(() => {
    return Math.min(campaign.progress.percentFunded, 100);
  }, [campaign.progress.percentFunded]);

  return (
    <article
      className={`campaign-card trending-card ${isSelected ? 'campaign-card-selected' : ''}`}
      onClick={() => onSelect(campaign.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(campaign.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View trending campaign: ${campaign.title}`}
    >
      <div className="trending-card-header">
        <strong className="campaign-title">{campaign.title}</strong>
        <span className={`badge badge-${campaign.progress.status}`}>
          {campaign.progress.status}
        </span>
      </div>

      <div className="campaign-progress">
        <div className="progress-copy">
          {campaign.pledgedAmount} / {campaign.targetAmount} {campaign.assetCode}
        </div>
        <div className="progress-bar" aria-hidden>
          <div
            style={{ width: `${percentFunded}%` }}
          />
        </div>
        <div className="muted">{campaign.progress.percentFunded}% funded</div>
      </div>

      <div className="trending-card-meta">
        <div className="trending-stat">
          <span className="trending-stat-label">Backers</span>
          <strong>{campaign.progress.pledgeCount}</strong>
        </div>
        <div className="trending-stat">
          <span className="trending-stat-label">Time Left</span>
          <strong>{formatTimeRemaining(campaign.progress.hoursLeft)}</strong>
        </div>
      </div>

      <div className="trending-card-creator">
        <AddressAvatar address={campaign.creator} size={20} />
        <span className="muted">{campaign.creator.slice(0, 8)}...</span>
      </div>
    </article>
  );
}

export function TrendingCampaigns({ onSelect, selectedCampaignId }: TrendingCampaignsProps) {
  const { trendingCampaigns, isLoading, error } = useTrendingCampaigns();

  if (isLoading && trendingCampaigns.length === 0) {
    return (
      <section className="trending-section animate-fade-in">
        <div className="section-heading">
          <h2>Trending Campaigns</h2>
          <p className="muted">Loading trending campaigns...</p>
        </div>
        <div className="trending-scroll-container">
          {[1, 2, 3].map((i) => (
            <div key={i} className="trending-card skeleton-card">
              <div className="skeleton skeleton-line" style={{ width: '70%', height: '20px' }} />
              <div className="skeleton skeleton-line" style={{ width: '100%', height: '10px', marginTop: '12px' }} />
              <div className="skeleton skeleton-line" style={{ width: '50%', height: '16px', marginTop: '8px' }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="trending-section animate-fade-in">
        <div className="section-heading">
          <h2>Trending Campaigns</h2>
          <p className="form-error">{error}</p>
        </div>
      </section>
    );
  }

  if (trendingCampaigns.length === 0) {
    return null;
  }

  return (
    <section className="trending-section animate-fade-in">
      <div className="section-heading">
        <h2>Trending Campaigns</h2>
        <p className="muted">Top campaigns by recent pledge activity</p>
      </div>

      <div className="trending-scroll-container" role="region" aria-label="Trending campaigns">
        {trendingCampaigns.map((campaign) => (
          <TrendingCard
            key={campaign.id}
            campaign={campaign}
            isSelected={selectedCampaignId === campaign.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

export default TrendingCampaigns;
