import { FormEvent, useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { MousePointer2, Download, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Campaign, AppConfig } from '../types/campaign';
import CopyButton from './CopyButton';
import { AddressAvatar } from './AddressAvatar';
import { EmptyState } from './EmptyState';
import { CampaignImage } from './CampaignImage';

const ContributorSummary = lazy(() =>
  import('./ContributorSummary').then((m) => ({ default: m.ContributorSummary })),
);
import { Countdown } from './Countdown';
import { useCampaignShareCard } from './CampaignShareCard';
import { useToast } from '../hooks/useToast';
import { ShareButtons } from './ShareButtons';
import { useMinDisplayTime } from '../hooks/useMinDisplayTime';

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  appConfig?: AppConfig | null;
  connectedWallet?: string | null;
  isConnectingWallet?: boolean;
  isLoading?: boolean;
  isPledgePending?: boolean;
  notFoundCampaignId?: string | null;
  onConnectWallet?: () => Promise<void>;
  onDisconnectWallet?: () => void;
  onPledge?: (campaignId: string, amount: number, assetCode: string) => Promise<void>;
  onClaim?: (campaign: Campaign) => Promise<void>;
  onSoftDelete?: (campaignId: string) => Promise<void>;
  onRefund?: (campaignId: string, contributor: string) => Promise<void>;
  onClose?: () => void;
}

const FEE_ESTIMATION_ERROR_CODES = new Set([
  'SIMULATION_FAILED',
  'SIMULATION_PREPARE_FAILED',
  'SOURCE_ACCOUNT_LOAD_FAILED',
  'STATE_RESTORE_REQUIRED',
]);

function describePledgeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && FEE_ESTIMATION_ERROR_CODES.has(code)) {
    return 'Could not estimate fee. Check your connection and retry.';
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'The pledge could not be completed. Please try again.';
}

function networkName(config: AppConfig | null | undefined): string {
  const passphrase = config?.networkPassphrase ?? config?.soroban?.networkPassphrase;

  if (!passphrase) {
    return 'Configured network';
  }
  if (passphrase === 'Test SDF Network ; September 2015') {
    return 'Stellar Testnet';
  }
  if (passphrase === 'Public Global Stellar Network ; September 2015') {
    return 'Stellar Mainnet';
  }

  return 'Configured network';
}

export function CampaignDetailPanel({
  campaign,
  appConfig,
  connectedWallet = null,
  isConnectingWallet = false,
  isLoading = false,
  isPledgePending = false,
  notFoundCampaignId = null,
  onConnectWallet = async () => {},
  onDisconnectWallet = () => {},
  onPledge = async () => {},
  onClaim = async () => {},
  onRefund = async () => {},
}: CampaignDetailPanelProps) {
  const [pledgeAmount, setPledgeAmount] = useState('25');
  const [pledgeToken, setPledgeToken] = useState('');
  const [refundContributor, setRefundContributor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [pledgeSuccess, setPledgeSuccess] = useState(false);
  const pledgeSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bannerImageError, setBannerImageError] = useState(false);
  const walletReady = appConfig?.walletIntegrationReady ?? false;
  const { downloadPng, toDataUrl } = useCampaignShareCard();
  const { addToast } = useToast();

  const handleDownloadPng = useCallback(() => {
    if (!campaign) return;
    downloadPng(campaign, campaign.metadata?.imageUrl);
    addToast('Campaign card downloaded as PNG.', 'success');
  }, [campaign, downloadPng, addToast]);

  const handleCopyLink = useCallback(() => {
    if (!campaign) return;
    const url = `${window.location.origin}/campaigns/${campaign.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        addToast('Campaign link copied to clipboard.', 'success', {
          href: url,
          label: url.slice(0, 40) + '…',
        });
      })
      .catch(() => {
        addToast('Failed to copy link.', 'error');
      });
  }, [campaign, addToast]);

  useEffect(() => {
    setBannerImageError(false);
  }, [campaign?.id, connectedWallet]);

  useEffect(() => {
    return () => {
      if (pledgeSuccessTimerRef.current !== null) {
        clearTimeout(pledgeSuccessTimerRef.current);
      }
    };
  }, []);

  const showSkeleton = useMinDisplayTime(isLoading);
  if (showSkeleton) {
    return (
      <section className="card detail-panel" aria-busy="true" aria-label="Loading campaign details">
        <div className="section-heading">
          <h2>
            <div className="skeleton skeleton-line" style={{ width: 220 }} />
          </h2>
          <div className="skeleton skeleton-line" style={{ width: 320, height: 14 }} />
        </div>
        <div className="detail-grid">
          {Array.from({ length: 5 }).map((_, index) => (
            <article key={index} className="detail-stat">
              <div className="skeleton skeleton-line" style={{ width: 120 }} />
              <div
                className="skeleton skeleton-line"
                style={{ width: 80, height: 18, marginTop: 8 }}
              />
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (notFoundCampaignId) {
    return (
      <section className="card detail-panel">
        <div className="section-heading">
          <h2>Campaign not found</h2>
          <p className="muted">
            The campaign <code>#{notFoundCampaignId}</code> does not exist or may have been removed.
          </p>
        </div>
        <div style={{ marginTop: 24 }}>
          <Link to="/" className="btn-ghost">
            Back to campaigns
          </Link>
        </div>
      </section>
    );
  }

  if (!campaign) {
    return (
      <EmptyState
        variant="card"
        icon={MousePointer2}
        title="Campaign actions"
        message="Pick a campaign from the board to manage it."
      />
    );
  }

  const activeCampaign = campaign;

  // Simulation is run (and the network fee estimated) before the preview modal
  // opens. If that simulation fails, surface a retry-able error next to the
  // pledge button instead of only relying on the toast.
  const selectedToken = pledgeToken || activeCampaign.assetCode;

  async function submitPledge() {
    setPledgeError(null);
    setPledgeSuccess(false);
    if (pledgeSuccessTimerRef.current !== null) {
      clearTimeout(pledgeSuccessTimerRef.current);
      pledgeSuccessTimerRef.current = null;
    }
    setIsSubmitting(true);
    try {
      await onPledge(activeCampaign.id, Number(pledgeAmount), selectedToken);
      setPledgeAmount('25');
      setPledgeToken('');
      setPledgeSuccess(true);
      pledgeSuccessTimerRef.current = setTimeout(() => {
        setPledgeSuccess(false);
        pledgeSuccessTimerRef.current = null;
      }, 4000);
    } catch (error) {
      setPledgeError(describePledgeError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitPledge();
  }

  async function handleRefund() {
    setIsSubmitting(true);
    try {
      await onRefund(activeCampaign.id, refundContributor.trim());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClaim() {
    setIsSubmitting(true);
    try {
      await onClaim(activeCampaign);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="card detail-panel" aria-labelledby="campaign-detail-title">
      {/* Full-width Campaign Banner */}
      <div className="campaign-detail-banner">
        {activeCampaign.metadata?.imageUrl && !bannerImageError ? (
          <img
            src={activeCampaign.metadata.imageUrl}
            alt={activeCampaign.title}
            onError={() => setBannerImageError(true)}
            className="campaign-detail-banner-image"
          />
        ) : null}
      </div>

      <div className="section-heading">
        <h2 id="campaign-detail-title">{activeCampaign.title}</h2>
        <p className="muted">{activeCampaign.description}</p>
      </div>

      <div className="wallet-status" role="group" aria-labelledby="wallet-status-title">
        <div>
          <h3 id="wallet-status-title" className="wallet-status-title">
            Wallet status
          </h3>
          <p className="muted">
            {connectedWallet
              ? `Connected to ${networkName(appConfig)}`
              : `Not connected — connect a wallet to take actions`}
          </p>
        </div>
        <div className="wallet-connected">
          {connectedWallet ? (
            <>
              <div className="wallet-address-row">
                <AddressAvatar address={connectedWallet} size={28} />
                <div className="wallet-address-value">
                  <strong className="mono">{connectedWallet.slice(0, 16)}...</strong>
                  <CopyButton value={connectedWallet} ariaLabel="Copy connected wallet address" />
                </div>
              </div>
              <button
                className="btn-ghost"
                type="button"
                onClick={onDisconnectWallet}
                disabled={isSubmitting}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                void onConnectWallet();
              }}
              disabled={isSubmitting || isConnectingWallet}
            >
              {isConnectingWallet ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      <div className="detail-grid" role="group" aria-label="Campaign summary">
        <article className="detail-stat">
          <span>Campaign ID</span>
          <div className="detail-stat-value">
            <strong className="mono">{activeCampaign.id}</strong>
            <CopyButton value={activeCampaign.id} ariaLabel="Copy campaign ID" />
          </div>
        </article>
        <article className="detail-stat">
          <span>Creator</span>
          <div className="detail-stat-value">
            <AddressAvatar address={activeCampaign.creator} size={28} />
            <div className="wallet-address-value">
              <strong className="mono">{activeCampaign.creator.slice(0, 16)}...</strong>
              <CopyButton value={activeCampaign.creator} ariaLabel="Copy creator address" />
            </div>
          </div>
        </article>
        <article className="detail-stat">
          <span>Asset</span>
          <strong>{activeCampaign.assetCode}</strong>
        </article>
        <article className="detail-stat">
          <span>Remaining</span>
          <strong>{activeCampaign.progress.remainingAmount}</strong>
        </article>
        <article className="detail-stat">
          <span>Active pledges</span>
          <strong>{activeCampaign.progress.pledgeCount}</strong>
        </article>
        <article className="detail-stat">
          <span>Time left</span>
          <strong>
            <Countdown deadline={activeCampaign.deadline} />
          </strong>
        </article>
      </div>

      <Suspense
        fallback={
          <div className="contributor-summary" aria-busy="true">
            Loading contributors…
          </div>
        }
      >
        <ContributorSummary
          campaignId={activeCampaign.id}
          assetCode={activeCampaign.assetCode}
          isLoading={isLoading}
        />
      </Suspense>

      {!walletReady ? (
        <p className="pending-note">
          Wallet integration is not fully configured yet. Freighter actions that require Soroban
          contract calls may stay disabled until backend config is set.
        </p>
      ) : null}

      <form
        className="form-grid"
        aria-label="Pledge campaign"
        aria-busy={isSubmitting || isPledgePending}
        aria-describedby={pledgeError ? 'pledge-error' : undefined}
        onSubmit={handlePledge}
      >
        <label className="field-group">
          <span>Connected contributor</span>
          <input
            type="text"
            value={connectedWallet ?? ''}
            placeholder="Connect a wallet to use the pledge flow"
            readOnly
          />
        </label>

        {activeCampaign.acceptedTokens?.length > 1 && (
          <label className="field-group">
            <span>Token</span>
            <select
              value={selectedToken}
              onChange={(e) => setPledgeToken(e.target.value)}
              required
              disabled={isSubmitting || isPledgePending}
            >
              {activeCampaign.acceptedTokens.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field-group">
          <span>Pledge amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={pledgeAmount}
            onChange={(event) => setPledgeAmount(event.target.value)}
            required
            disabled={isSubmitting || isPledgePending}
          />
        </label>

        <div className="action-row campaign-detail-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={
              isSubmitting ||
              isPledgePending ||
              !activeCampaign.progress.canPledge ||
              !connectedWallet
            }
          >
            {isSubmitting || isPledgePending ? 'Submitting...' : 'Add pledge'}
          </button>

          <button
            className="btn-ghost"
            type="button"
            disabled={
              isSubmitting ||
              !activeCampaign.progress.canClaim ||
              !connectedWallet ||
              connectedWallet !== activeCampaign.creator ||
              !walletReady
            }
            onClick={() => {
              void handleClaim();
            }}
          >
            Claim vault
          </button>
        </div>

        {pledgeError ? (
          <div className="pledge-error" id="pledge-error" role="alert" aria-live="assertive">
            <p className="error-text">{pledgeError}</p>
            <button
              className="btn-ghost"
              type="button"
              disabled={isSubmitting || isPledgePending}
              onClick={() => {
                void submitPledge();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {pledgeSuccess ? (
          <p className="form-success" role="status" aria-live="polite">
            Pledge submitted successfully.
          </p>
        ) : null}

        {!activeCampaign.progress.canPledge && !isSubmitting && !isPledgePending ? (
          <p className="muted" style={{ fontSize: '0.875rem', marginTop: 4 }}>
            {activeCampaign.progress.status === 'funded'
              ? 'This campaign has reached its goal and is no longer accepting pledges.'
              : activeCampaign.progress.status === 'claimed'
                ? 'The creator has already claimed this campaign.'
                : activeCampaign.progress.status === 'failed'
                  ? 'This campaign did not reach its goal before the deadline.'
                  : 'Pledging is not available for this campaign.'}
          </p>
        ) : null}
      </form>

      <div
        className="form-grid"
        style={{ marginTop: 16 }}
        role="group"
        aria-label="Refund contributor"
      >
        <label className="field-group">
          <span>Refund contributor</span>
          <input
            type="text"
            value={refundContributor}
            onChange={(event) => setRefundContributor(event.target.value)}
            placeholder="G... contributor public key"
          />
        </label>

        <div className="action-row campaign-detail-actions">
          <button
            className="btn-ghost"
            type="button"
            disabled={
              isSubmitting ||
              !activeCampaign.progress.canRefund ||
              refundContributor.trim().length === 0
            }
            onClick={() => {
              void handleRefund();
            }}
          >
            Refund contributor
          </button>
        </div>
      </div>

      {isPledgePending ? (
        <p className="pending-note" role="status" aria-live="polite">
          The pledge transaction is in flight. Campaign state will refresh after the backend
          reconciles the result.
        </p>
      ) : null}

      {activeCampaign.metadata?.externalLink ? (
        <div className="external-link-container">
          <a
            href={activeCampaign.metadata.externalLink}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            Visit project website
          </a>
        </div>
      ) : null}

      <div className="share-actions" role="group" aria-label="Campaign actions">
        <button className="btn-ghost" type="button" onClick={handleDownloadPng}>
          <Download size={16} />
          Download PNG
        </button>
        <button className="btn-ghost" type="button" onClick={handleCopyLink}>
          <LinkIcon size={16} />
          Copy link
        </button>
      </div>
      <ShareButtons campaign={activeCampaign} />
    </section>
  );
}
