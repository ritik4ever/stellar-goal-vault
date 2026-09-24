import { memo, useEffect, useState } from 'react';
import { Link } from 'lucide-react';
import { Campaign } from '../types/campaign';
import AddressAvatar from './AddressAvatar';
import CopyButton from './CopyButton';
import { Countdown } from './Countdown';

/**
 * Returns true for one commit after `percentFunded` changes (excluding the
 * initial mount). Uses the React-sanctioned "adjust state during render"
 * pattern so the transition class lands in the same commit as the new bar
 * width — attaching it in a post-render effect instead would let the first
 * funding change paint instantly rather than animate.
 */
function useProgressBarAnimation(percentFunded: number): boolean {
  const [animate, setAnimate] = useState(false);
  const [lastRenderedPercent, setLastRenderedPercent] = useState(percentFunded);

  if (percentFunded !== lastRenderedPercent) {
    setLastRenderedPercent(percentFunded);
    setAnimate(true);
  }

  // Drop the transition class once the animation window has passed so the
  // next change can re-arm it cleanly (450ms > the 400ms transition).
  useEffect(() => {
    if (!animate) {
      return;
    }
    const timer = window.setTimeout(() => setAnimate(false), 450);
    return () => window.clearTimeout(timer);
  }, [animate]);

  return animate;
}

interface CampaignCardProps {
  campaign: Campaign;
  selectedCampaignId: string | null;
  onSelect: (campaignId: string) => void;
}

function CampaignCardInner({ campaign, selectedCampaignId, onSelect }: CampaignCardProps) {
  const [imageError, setImageError] = useState(false);
  const animate = useProgressBarAnimation(campaign.progress.percentFunded);

  // Reset image error when campaign changes
  useEffect(() => {
    setImageError(false);
  }, [campaign.id]);

  const handleShareCampaign = () => {
    const deepLinkUrl = `${window.location.origin}${window.location.pathname}?campaign=${campaign.id}`;
    navigator.clipboard
      .writeText(deepLinkUrl)
      .then(() => {
        // Share action complete
      })
      .catch(() => {
        // Copy failed
      });
  };

  return (
    <article
      className={`campaign-card ${selectedCampaignId === campaign.id ? 'campaign-card-selected' : ''}`}
    >
      {/* Campaign Banner Image or Gradient Fallback */}
      <div
        style={{
          width: '100%',
          height: '160px',
          overflow: 'hidden',
          borderRadius: '8px 8px 0 0',
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          position: 'relative',
        }}
      >
        {campaign.metadata?.imageUrl && !imageError ? (
          <img
            src={campaign.metadata.imageUrl}
            alt={campaign.title}
            onError={() => setImageError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
      </div>

      <div className="campaign-card-main">
        <div className="campaign-card-header">
          <div>
            <strong className="campaign-title">{campaign.title}</strong>
            <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>#{campaign.id}</span>
              <CopyButton value={campaign.id} ariaLabel="Copy campaign ID" className="small" />
              <button
                type="button"
                onClick={handleShareCampaign}
                aria-label="Copy campaign share link"
                className="small"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.6,
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                }}
              >
                <Link size={16} />
              </button>
            </div>
          </div>
          <div
            className="campaign-creator mono"
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <AddressAvatar address={campaign.creator} size={24} />
            <span>{campaign.creator.slice(0, 8)}...</span>
            <CopyButton
              value={campaign.creator}
              ariaLabel="Copy creator address"
              className="small"
            />
          </div>
        </div>

        <div className="campaign-progress">
          <div className="progress-copy">
            {campaign.pledgedAmount} / {campaign.targetAmount}{' '}
            {campaign.acceptedTokens?.length > 1 ? 'Tokens' : campaign.assetCode}
          </div>
          {campaign.acceptedTokens?.length > 1 && campaign.tokenBalances ? (
            <div className="token-progress-list" aria-label="Per-token progress">
              {campaign.acceptedTokens.map((token) => {
                const balance = campaign.tokenBalances![token] ?? 0;
                const pct =
                  campaign.targetAmount > 0
                    ? Math.min(Math.round((balance / campaign.targetAmount) * 100), 100)
                    : 0;
                return (
                  <div key={token} className="token-progress-row">
                    <span className="token-label muted">{token}</span>
                    <div className="progress-bar" aria-hidden>
                      <div style={{ width: `${pct}%` }} />
                    </div>
                    <span className="token-balance muted">{balance}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="progress-bar" aria-hidden>
              <div
                className={animate ? 'progress-bar-fill' : undefined}
                style={{
                  width: `${Math.min(campaign.progress.percentFunded, 100)}%`,
                }}
              />
            </div>
          )}
          <div className="muted">{campaign.progress.percentFunded}% funded</div>
        </div>

        <div className="campaign-meta">
          <span className={`badge badge-${campaign.progress.status}`}>
            {campaign.progress.status}
          </span>
          <div className="muted"><Countdown deadline={campaign.deadline} /></div>
        </div>
      </div>

      <div className="campaign-card-actions">
        <button
          className={selectedCampaignId === campaign.id ? 'btn-secondary' : 'btn-primary'}
          type="button"
          onClick={() => onSelect(campaign.id)}
        >
          {selectedCampaignId === campaign.id ? 'Selected' : 'Manage'}
        </button>
      </div>
    </article>
  );
}

function areEqual(prevProps: CampaignCardProps, nextProps: CampaignCardProps): boolean {
  return (
    prevProps.campaign.id === nextProps.campaign.id &&
    prevProps.campaign.pledgedAmount === nextProps.campaign.pledgedAmount &&
    prevProps.campaign.progress.percentFunded === nextProps.campaign.progress.percentFunded &&
    prevProps.selectedCampaignId === nextProps.selectedCampaignId
  );
}

export const CampaignCard = memo(CampaignCardInner, areEqual);

export default CampaignCard;
