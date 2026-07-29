import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getCampaign } from '../services/api';
import type { Campaign } from '../types/campaign';

type EmbedSize = '300x200' | '600x300';

function formatDeadline(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;

  if (diff <= 0) return 'Ended';

  const hours = Math.floor(diff / 3600);
  if (hours < 1) return '< 1h left';
  if (hours < 24) return `${hours}h left`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d left`;

  const months = Math.floor(days / 30);
  return `${months}mo left`;
}

function EmbedWidgetInner({ campaign, embedSize }: { campaign: Campaign; embedSize: EmbedSize }) {
  const percent = Math.min(campaign.progress.percentFunded, 100);
  const isCompact = embedSize === '300x200';

  return (
    <div className={`embed-widget embed-widget--${embedSize}`}>
      <div className="embed-widget-body">
        <h3 className="embed-widget-title">{campaign.title}</h3>

        <div className="embed-widget-progress">
          <div className="embed-widget-progress-bar" aria-hidden>
            <div style={{ width: `${percent}%` }} />
          </div>
          {!isCompact && (
            <span className="embed-widget-percent">{campaign.progress.percentFunded}%</span>
          )}
        </div>

        <div className="embed-widget-stats">
          <div className="embed-widget-stat">
            <span className="embed-widget-stat-label">{isCompact ? 'Raised' : 'Raised'}</span>
            <strong className="embed-widget-stat-value">
              {campaign.pledgedAmount} {campaign.assetCode}
            </strong>
          </div>
          <div className="embed-widget-stat">
            <span className="embed-widget-stat-label">{isCompact ? 'Goal' : 'Target'}</span>
            <strong className="embed-widget-stat-value">
              {campaign.targetAmount} {campaign.assetCode}
            </strong>
          </div>
          <div className="embed-widget-stat">
            <span className="embed-widget-stat-label">{isCompact ? 'Time' : 'Deadline'}</span>
            <strong className="embed-widget-stat-value">{formatDeadline(campaign.deadline)}</strong>
          </div>
        </div>
      </div>

      <a
        href={`${window.location.origin}/?campaign=${campaign.id}`}
        className="embed-widget-cta"
        target="_top"
        rel="noopener noreferrer"
      >
        Back this campaign
      </a>
    </div>
  );
}

export function EmbedWidget() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [embedSize, setEmbedSize] = useState<EmbedSize>('600x300');

  useEffect(() => {
    const container = document.querySelector('.embed-widget-root');
    if (container) {
      const width = container.clientWidth;
      setEmbedSize(width <= 350 ? '300x200' : '600x300');
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setError('No campaign ID provided');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const data = await getCampaign(id);
        if (!cancelled) {
          setCampaign(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load campaign');
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="embed-widget embed-widget-loading">
        <div className="embed-widget-skeleton embed-widget-skeleton-title" />
        <div className="embed-widget-skeleton embed-widget-skeleton-bar" />
        <div className="embed-widget-skeleton embed-widget-skeleton-stats" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="embed-widget embed-widget-error">
        <p>{error ?? 'Campaign not found'}</p>
      </div>
    );
  }

  return <EmbedWidgetInner campaign={campaign} embedSize={embedSize} />;
}

export default EmbedWidget;
