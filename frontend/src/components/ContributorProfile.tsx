import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { User, History, Award, Wallet, TrendingUp, ExternalLink } from 'lucide-react';
import { AddressAvatar } from './AddressAvatar';
import { CopyButton } from './CopyButton';
import { EmptyState } from './EmptyState';
import { getContributorProfile } from '../services/api';
import type { ContributorProfile as ContributorProfileData } from '../types/campaign';

function formatTimestamp(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatAmount(amount: number, assetCode: string): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${assetCode}`;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  funded: 'Funded',
  claimed: 'Claimed',
  failed: 'Failed',
};

export function ContributorProfile() {
  const { address } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<ContributorProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!address) return;
    try {
      setError(null);
      const data = await getContributorProfile(address);
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contributor profile');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setIsLoading(true);
    setProfile(null);
    void fetchProfile();
    timerRef.current = setInterval(() => void fetchProfile(), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchProfile]);

  if (!address) {
    return (
      <div className="app-shell">
        <EmptyState message="No address provided." />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app-shell">
        <section className="hero animate-fade-in">
          <div className="hero-topline">
            <div>
              <div className="eyebrow">Contributor Profile</div>
              <h1>Loading...</h1>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-shell">
        <section className="hero animate-fade-in">
          <div className="hero-topline">
            <div>
              <div className="eyebrow">Contributor Profile</div>
              <h1>Error loading profile</h1>
            </div>
          </div>
          <p className="hero-copy muted">{error}</p>
          <button type="button" className="btn-primary" onClick={() => void fetchProfile()}>
            Retry
          </button>
        </section>
      </div>
    );
  }

  if (profile && profile.campaignCount === 0) {
    return (
      <div className="app-shell">
        <section className="hero animate-fade-in">
          <div className="hero-topline">
            <div>
              <div className="eyebrow">Contributor Profile</div>
              <h1>No activity found</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <AddressAvatar address={address} size={40} />
            <span className="mono">{address.slice(0, 16)}...</span>
            <CopyButton value={address} ariaLabel="Copy address" />
          </div>
          <p className="hero-copy muted">
            This address hasn&apos;t backed any campaigns yet.
          </p>
          <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
            Browse campaigns
          </Link>
        </section>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="app-shell">
      <section className="hero animate-fade-in">
        <div className="hero-topline">
          <div>
            <div className="eyebrow">Contributor Profile</div>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AddressAvatar address={address} size={40} />
              <span className="mono" style={{ fontSize: '1.4rem' }}>
                {address.slice(0, 12)}...{address.slice(-4)}
              </span>
              <CopyButton value={address} ariaLabel="Copy address" />
            </h1>
          </div>
        </div>
      </section>

      <div className="metric-grid" style={{ marginBottom: 40 }}>
        <div className="metric-card">
          <span>Total Pledged</span>
          <strong>{profile.totalPledged.toLocaleString()}</strong>
        </div>
        <div className="metric-card">
          <span>Campaigns Backed</span>
          <strong>{profile.campaignCount}</strong>
        </div>
        <div className="metric-card">
          <span>Refunded</span>
          <strong>{profile.refundedAmount.toLocaleString()}</strong>
        </div>
        <div className="metric-card">
          <span>Global Rank</span>
          <strong>{profile.rank > 0 ? `#${profile.rank}` : '—'}</strong>
        </div>
      </div>

      {profile.badges.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <div className="section-heading">
            <h2><Award size={20} /> Badges Earned</h2>
            <p className="muted">{profile.badges.length} badge{profile.badges.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {profile.badges.map((badge) => (
              <div key={badge.name} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.5rem' }}>{badge.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{badge.name}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{badge.description}</div>
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                    Earned {formatTimestamp(badge.earnedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 40 }}>
        <div className="section-heading">
          <h2><TrendingUp size={20} /> Backed Campaigns</h2>
          <p className="muted">{profile.backedCampaigns.length} campaign{profile.backedCampaigns.length !== 1 ? 's' : ''}</p>
        </div>
        {profile.backedCampaigns.length === 0 ? (
          <EmptyState message="No backed campaigns." />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {profile.backedCampaigns.map((campaign) => (
              <Link
                key={campaign.campaignId}
                to={`/campaigns/${campaign.campaignId}`}
                className="card"
                style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Wallet size={18} className="muted" style={{ flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {campaign.title}
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      Pledged {formatAmount(campaign.pledgedAmount, campaign.assetCode)} · {formatTimestamp(campaign.pledgedAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className={`badge badge-${campaign.status}`}>{STATUS_LABELS[campaign.status]}</span>
                  {campaign.refundedAmount > 0 && (
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      Refunded {formatAmount(campaign.refundedAmount, campaign.assetCode)}
                    </span>
                  )}
                  <ExternalLink size={14} className="muted" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {profile.refundHistory.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <div className="section-heading">
            <h2><History size={20} /> Refund History</h2>
            <p className="muted">{profile.refundHistory.length} refund{profile.refundHistory.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {profile.refundHistory.map((refund, index) => (
              <div
                key={`${refund.campaignId}-${refund.refundedAt}-${index}`}
                className="card"
                style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <span style={{ fontWeight: 500 }}>{refund.title}</span>
                  <span className="muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>
                    {formatTimestamp(refund.refundedAt)}
                  </span>
                </div>
                <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                  {formatAmount(refund.amount, refund.assetCode)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <Link to="/" className="btn-ghost">
          Back to campaigns
        </Link>
      </div>
    </div>
  );
}

export default ContributorProfile;
