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
  const pledgeErrorRef = useRef<HTMLDivElement | null>(null);
  const pledgeSuccessRef = useRef<HTMLDivElement | null>(null);

  const handleDownloadPng = useCallback(() => {
    if (!campaign) return;
    downloadPng(campaign, campaign.metadata?.imageUrl);
    addToast('Campaign card downloaded as PNG.', 'success');
  }, [campaign, downloadPng, addToast]);

  const handleCopyLink = useCallback(() => {
    if (!campaign) return;
    const url = `${window.location.origin}/campaigns/${campaign.id}`;
    navigator.clipboard.writeText(url).then(() => {
      addToast('Campaign link copied to clipboard.', 'success', { href: url, label: url.slice(0, 40) + '…'});
    }).catch(() => {
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

  // Announce pledge errors and successes to screen readers without moving focus.
  useEffect(() => {
    if (pledgeError && pledgeErrorRef.current) {
      pledgeErrorRef.current.focus();
    }
  }, [pledgeError]);

  useEffect(() => {
    if (pledgeSuccess && pledgeSuccessRef.current) {
      pledgeSuccessRef.current.focus();
    }
  }, [pledgeSuccess]);

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
            The campaign <code>#${notFoundCampaignId}</code> does not exist or may have been removed.
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
      <div
        className="campaign-detail-banner"
      >
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
          <h3 id="wallet-status-title" className="wallet-status-title">Wallet status</h3>
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
          <strong><Countdown deadline={activeCampaign.deadline} /></strong>
        </article>
      </div>

      <Suspense fallback={<div className="contributor-summary" aria-busy="true">Loading contributors …</div>}>
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
        aria-label="Pledge form"
        onSubmit={handlePledge}
        noValidate
      >
        <div className="form-field">
          <label htmlFor="pledge-amount">Amount</label>
          <input
            id="pledge-amount"
            type="number"
            min="1"
            step="1"
            value={pledgeAmount}
            onChange={(e) => setPledgeAmount(e.target.value)}
            aria-description="pledge-amount-help"
            required
          />
          <small id="pledge-amount-help" className="muted">
            Enter the amount you want to pledge.
          </small>
        </div>

        <div className="form-field">
          <label htmlFor="pledge-token">Asset</label>
          <select
            id="pledge-token"
            value={pledgeToken}
            onChange={(e) => setPledgeToken(e.target.value)}
          >
            <option value="">{`Default (${activeCampaign.assetCode})`}</option>
            <option value={activeCampaign.assetCode}>{activeCampaign.assetCode}</option>
          </select>
        </div>

        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={isSubmitting || isPledgePending || !walletReady}
            aria-busy={isSubmitting || isPledgePending}
          >
            {isSubmitting || isPledgePending ? 'Submitting...' : 'Pledge'}
          </button>
        </div>

        {pledgeError ? (
          <div
            ref={pledgeErrorRef}
            className="form-error"
            role="alert"
            tabIndex={-1}
          >
            {pledgeError}
          </div>
        ) : null}

        {pledgeSuccess ? (
          <div
            ref={pledgeSuccessRef}
            className="form-success"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            Your pledge was submitted successfully.
          </div>
        ) : null}
      </form>

      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="refund-contributor">Contributor address</label>
          <input
            id="refund-contributor"
            type="text"
            value={refundContributor}
            onChange={(e) => setRefundContributor(e.target.value)}
            placeholder="G"..."
            aria-description="refund-contributor-help"
          />
          <small id="refund-contributor-help" className="muted">
            Enter the contributor address to refund.
          </small>
        </div>

        <div className="form-actions">
          <button
            className="btn-ghost"
            type="button"
            onClick={handleRefund}
            disabled={isSubmitting || !walletReady}
          >
            Refund
          </button>
        </div>
      </div>

      <div className="form-actions">
        <button
          className="btn-primary"
          type="button"
          onClick={handleClaim}
          disabled={isSubmitting || !walletReady}
        >
          Claim funds
        </button>
      </div>

      <div className="detail-actions">
        <button className="btn-ghost" type="button" onClick={handleDownloadPng}>
          <Download size={16} aria-hidden="true" /> Download card
        </button>
        <button className="btn-ghost" type="button" onClick={handleCopyLink}>
          <LinkIcon size={16} aria-hidden="true" /> Copy link
        </button>
        <ShareButtons campaign={activeCampaign} />
      </div>
    </section>
  );
}
