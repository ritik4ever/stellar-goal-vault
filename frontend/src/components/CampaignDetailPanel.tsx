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
import { formatAmount } from '../utils/formatCurrency';
import { useToast } from '../hooks/useToast';
import { ShareButtons } from './ShareButtons';
import { useMinDisplayTime } from '../hooks/useMinDisplayTime';
import { safeErrorMessage } from '../lib/signingErrors';

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  appConfig?: AppConfig | null;
  connectedWallet?: string | null;
  isConnectingWallet?: boolean;
  isLoading?: boolean;
  isPledgePending?: boolean;
  notFoundCampaignId?: string | null;
  walletNetworkPassphrase?: string | null;
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
  return safeErrorMessage(error, 'The pledge could not be completed. Please try again.');
}

function networkName(config: AppConfig | null | undefined): string {
  const passphrase = config?.networkPassphrase ?? config?.soroban?.networkPassphrase;

  if (!passphrase) {
    return 'Configured network';
  }
  if (passphrase.includes('Test SDF Network') || passphrase.includes('Test DF Network')) {
    return 'Stellar Testnet';
  }
  if (passphrase.includes('Public Global Stellar Network')) {
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
  walletNetworkPassphrase = null,
  onConnectWallet = async () => {},
  onDisconnectWallet = () => {},
  onPledge = async () => {},
  onClaim = async () => {},
  onRefund = async () => {},
}: CampaignDetailPanelProps) {
  const [pledgeAmount, setPledgeAmount] = useState<string>('25');
  const [pledgeToken, setPledgeToken] = useState<string>('');
  const [refundContributor, setRefundContributor] = useState<string>('');
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

  // Detect wallet/application network mismatch. The wallet reports the network it is currently
  // configured for (walletNetworkPassphrase); when it differs from the app's
  // configured passphrase we must block submission and surface a recovery path.
  const appNetworkPassphrase =
    appConfig?.networkPassphrase ?? appConfig?.soroban?.networkPassphrase ?? null;
  const activeWalletNetworkPassphrase = walletNetworkPassphrase ?? appConfig?.walletNetworkPassphrase ?? null;
  const hasNetworkMismatch = Boolean(
    connectedWallet &&
      appNetworkPassphrase &&
      activeWalletNetworkPassphrase &&
      appNetworkPassphrase !== activeWalletNetworkPassphrase,
  );
  const networkMismatchMessage = hasNetworkMismatch
    ? `Network mismatch: your wallet is on ${networkName({ ...(appConfig ?? {}), networkPassphrase: activeWalletNetworkPassphrase } as AppConfig)} but this app uses ${networkName(appConfig)}. Switch your Freighter network to ${networkName(appConfig)} and reconnect.`
    : null;

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
            The campaign <code>#{notFoundCampaignId}</code> does not exist or may have been
            removed.
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
  const availableTokens = Array.from(
    new Set([ ...(activeCampaign.acceptedTokens ?? []), activeCampaign.assetCode ]),
  );

  async function submitPledge() {
    setPledgeError(null);
    setPledgeSuccess(false);
    if (pledgeSuccessTimerRef.current !== null) {
      clearTimeout(pledgeSuccessTimerRef.current);
      pledgeSuccessTimerRef.current = null;
    }
    // Never submit a transaction when the wallet network differs from the app's
    // configured network. Surface an actionable message instead of attempting the
    // signing flow.
    if (hasNetworkMismatch) {
      addToast(networkMismatchMessage ?? 'Network mismatch.', 'error');
      return;
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
    if (hasNetworkMismatch) {
      addToast(networkMismatchMessage ?? 'Network mismatch.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      await onRefund(activeCampaign.id, refundContributor.trim());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClaim() {
    if (hasNetworkMismatch) {
      addToast(networkMismatchMessage ?? 'Network mismatch.', 'error');
      return;
    }
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
              disabled={isConnectingWallet}
            >
              {isConnectingWallet ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Campaign Summary Stats with deterministic Countdown */}
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
          <strong>{formatAmount(activeCampaign.progress.remainingAmount, activeCampaign.assetCode)}</strong>
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

      {hasNetworkMismatch ? (
        <div className="network-mismatch-banner" role="alert">
          <strong>Network mismatch</strong>
          <p>{networkMismatchMessage}</p>
        </div>
      ) : null}

      <form
        className="pledge-form form-grid"
        aria-label="Pledge form"
        aria-busy={isSubmitting || isPledgePending}
        onSubmit={handlePledge}
      >
        <div className="form-field field-group">
          <label htmlFor="pledge-amount">Amount</label>
          <input
            id="pledge-amount"
            aria-label="Amount"
            type="number"
            min="0"
            step="any"
            value={pledgeAmount}
            onChange={(e) => setPledgeAmount(e.target.value)}
            disabled={isSubmitting || isPledgePending}
            aria-description="pledge-amount-help"
            required
          />
          <small id="pledge-amount-help" className="muted">
            Enter the amount you want to pledge.
          </small>
        </div>
        {!activeCampaign.acceptedTokens || activeCampaign.acceptedTokens.length > 1 ? (
          <div className="form-field field-group">
            <label htmlFor="pledge-token">Asset</label>
            <select
              id="pledge-token"
              aria-label="Asset"
              value={pledgeToken}
              onChange={(e) => setPledgeToken(e.target.value)}
              disabled={isSubmitting || isPledgePending}
            >
              <option value="">Default ({activeCampaign.assetCode})</option>
              {availableTokens.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="form-actions action-row campaign-detail-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={
              isSubmitting ||
              isPledgePending ||
              !activeCampaign.progress.canPledge
            }
          >
            {isSubmitting || isPledgePending ? 'Submitting...' : 'Pledge'}
          </button>
        </div>
        {pledgeError ? (
          <div className="pledge-error form-error" role="alert" ref={pledgeErrorRef} tabIndex={-1}>
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
          <div
            className="form-success"
            role="status"
            aria-live="polite"
            ref={pledgeSuccessRef}
            tabIndex={-1}
          >
            Your pledge was submitted successfully. Pledge submitted successfully.
          </div>
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

      {isPledgePending ? (
        <p className="pending-note" role="status" aria-live="polite">
          The pledge transaction is in flight. Campaign state will refresh after the backend
          reconciles the result.
        </p>
      ) : null}

      <div className="form-grid" role="group" aria-label="Refund contributor">
        <label className="field-group">
          <span>Refund contributor</span>
          <input
            type="text"
            value={refundContributor}
            onChange={(e) => setRefundContributor(e.target.value)}
            placeholder="G... contributor public key"
            disabled={isSubmitting}
          />
        </label>
        <div className="action-row campaign-detail-actions">
          <button
            className="btn-ghost"
            type="button"
            onClick={handleRefund}
            disabled={
              isSubmitting ||
              hasNetworkMismatch ||
              !activeCampaign.progress?.canRefund ||
              refundContributor.trim().length === 0
            }
          >
            Refund contributor
          </button>
        </div>
      </div>

      {activeCampaign.progress?.canClaim ? (
        <div className="form-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={handleClaim}
            disabled={isSubmitting || hasNetworkMismatch}
          >
            Claim funds
          </button>
        </div>
      ) : null}

      <div className="detail-actions" role="group" aria-label="Campaign actions">
        <button className="btn-ghost" type="button" onClick={handleDownloadPng}>
          <Download size={16} aria-hidden="true" />
          Download card
        </button>
        <button className="btn-ghost" type="button" onClick={handleCopyLink}>
          <LinkIcon size={16} aria-hidden="true" />
          Copy link
        </button>
        <ShareButtons campaign={activeCampaign} />
      </div>

      <Suspense fallback={null}>
        <ContributorSummary campaignId={activeCampaign.id} assetCode={activeCampaign.assetCode} />
      </Suspense>
    </section>
  );
}
