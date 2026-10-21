import { FormEvent, useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import {
  MousePointer2,
  Download,
  Link as LinkIcon,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';
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
import { safeErrorMessage } from '../lib/signingErrors';
import {
  TransactionState,
  getStatusLabel,
  getStatusMessage,
  isTerminalStatus,
} from '../lib/transactionStatus';

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
  // Transaction state (deterministic transaction status handling)
  transactionState?: TransactionState | undefined;
  onRetryTransaction?: () => void;
  onClearTransaction?: () => void;
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
  if (passphrase === 'Test DF Network ;; September 2015') {
    return 'Stellar Testnet';
  }
  if (passphrase === 'Public Global Stellar Network ;; September 2015') {
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
  onClose = () => {},
  // Transaction state (deterministic transaction status handling)
  transactionState = undefined,
  onRetryTransaction = () => {},
  onClearTransaction = () => {},
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
  const activeWalletNetworkPassphrase =
    walletNetworkPassphrase ?? appConfig?.walletNetworkPassphrase ?? null;
  const hasNetworkMismatch = Boolean(
    connectedWallet &&
    appNetworkPassphrase &&
    activeWalletNetworkPassphrase &&
    appNetworkPassphrase !== activeWalletNetworkPassphrase,
  );
  const networkMismatchMessage = hasNetworkMismatch
    ? `Network mismatch: your wallet is on ${networkName({ ...(appConfig ?? {}), networkPassphrase: activeWalletNetworkPassphrase } as AppConfig)} but this app uses ${networkName(appConfig)}. Switch your Freighter network to ${networkName(appConfig)} and reconnect.`
    : null;

  // Transaction status handling. The parent owns the transaction lifecycle; this
  // panel only reflects it and exposes retry/dismiss affordances.
  const isTransactionInProgress =
    transactionState !== undefined &&
    (transactionState.status === 'pending' || transactionState.status === 'retryable');

  // The form is locked while a transaction is in flight, while the parent reports
  // a pledge in flight, and while the wallet integration is not ready.
  const isFormDisabled = isTransactionInProgress || isSubmitting || isPledgePending || !walletReady;

  const transactionStatusMessage = transactionState ? getStatusMessage(transactionState) : null;
  const statusLabel = transactionState ? getStatusLabel(transactionState.status) : null;
  const showRetry =
    transactionState !== undefined &&
    (transactionState.status === 'retryable' || transactionState.status === 'failed');
  const showClear = transactionState !== undefined && isTerminalStatus(transactionState.status);

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
            The campaign <code>#${notFoundCampaignId}</code> does not exist or may have been
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
    new Set([...(activeCampaign.acceptedTokens ?? []), activeCampaign.assetCode]),
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
      setPledgeError(networkMismatchMessage);
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

  function handleRetry() {
    onRetryTransaction();
    setPledgeError(null);
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

      {hasNetworkMismatch ? (
        <div className="network-mismatch-banner" role="alert">
          <strong>Network mismatch</strong>
          <p>{networkMismatchMessage}</p>
        </div>
      ) : null}

      <form
        className="pledge-form"
        aria-label="Pledge form"
        onSubmit={handlePledge}
        aria-busy={isTransactionInProgress}
      >
        <label>
          Amount
          <input
            type="number"
            min="0"
            step="any"
            value={pledgeAmount}
            onChange={(e) => setPledgeAmount(e.target.value)}
            disabled={isFormDisabled}
          />
        </label>
        {availableTokens.length > 1 ? (
          <label>
            Asset
            <select
              value={pledgeToken}
              onChange={(e) => setPledgeToken(e.target.value)}
              disabled={isFormDisabled}
            >
              <option value="">Default ({activeCampaign.assetCode})</option>
              {availableTokens.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {transactionState ? (
          <div className="transaction-status">
            <div className={`status-display status-${transactionState.status}`}>
              <span className="status-icon">
                {transactionState.status === 'pending' && <Clock className="spinning" />}
                {transactionState.status === 'confirmed' && <CheckCircle />}
                {transactionState.status === 'failed' && <AlertCircle />}
                {transactionState.status === 'retryable' && <RefreshCw />}
              </span>
              <div className="status-info">
                <span className="status-label">{statusLabel}</span>
                <span className="status-message">{transactionStatusMessage}</span>
              </div>
              <div className="status-actions">
                {showRetry ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleRetry}
                    aria-label="Retry transaction"
                  >
                    <RefreshCw size={16} aria-hidden="true" /> Retry
                  </button>
                ) : null}
                {showClear ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={onClearTransaction}
                    aria-label="Dismiss transaction status"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
        <button type="submit" disabled={isFormDisabled || hasNetworkMismatch}>
          {isTransactionInProgress ? 'Submitting...' : isSubmitting ? 'Submitting…' : 'Pledge'}
        </button>
        {pledgeError && !transactionState ? (
          <div role="alert" ref={pledgeErrorRef} tabIndex={-1}>
            {pledgeError}
          </div>
        ) : null}
        {pledgeSuccess && !transactionState ? (
          <div role="status" ref={pledgeSuccessRef} tabIndex={-1}>
            Your pledge was submitted successfully.
          </div>
        ) : null}
      </form>

      {activeCampaign.progress?.canClaim ? (
        <button type="button" onClick={handleClaim} disabled={isFormDisabled || hasNetworkMismatch}>
          Claim Funds
        </button>
      ) : null}

      {activeCampaign.progress?.canClaim ? (
        <div className="refund-form">
          <label>
            Contributor address
            <input
              type="text"
              value={refundContributor}
              onChange={(e) => setRefundContributor(e.target.value)}
              disabled={isFormDisabled}
            />
          </label>
          <button
            type="button"
            onClick={handleRefund}
            disabled={isFormDisabled || hasNetworkMismatch}
          >
            Refund
          </button>
        </div>
      ) : null}

      <div className="detail-actions">
        <button type="button" onClick={handleDownloadPng}>
          <Download size={16} />
          Download card
        </button>
        <button type="button" onClick={handleCopyLink}>
          <LinkIcon size={16} />
          Copy link
        </button>
      </div>

      <Suspense
        fallback={
          <div className="contributor-summary" aria-busy="true">
            Loading contributors …
          </div>
        }
      >
        <ContributorSummary
          campaignId={activeCampaign.id}
          assetCode={activeCampaign.assetCode}
          isLoading={isLoading}
        />
      </Suspense>
    </section>
  );
}
