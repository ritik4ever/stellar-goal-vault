

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  appConfig?: AppConfig | null;
  connectedWallet?: string | null;
  isConnectingWallet?: boolean;
  isLoading?: boolean;
  isPledgePending?: boolean;
  onConnectWallet?: () => Promise<void>;
  onDisconnectWallet?: () => void;
  onPledge?: (campaignId: string, amount: number, assetCode: string) => Promise<void>;
  onClaim?: (campaign: Campaign) => Promise<void>;
  onSoftDelete?: (campaignId: string) => Promise<void>;
  onRefund?: (campaignId: string, contributor: string) => Promise<void>;
}

const FEE_ESTIMATION_ERROR_CODES = new Set([
  "SIMULATION_FAILED",
  "SIMULATION_PREPARE_FAILED",
  "SOURCE_ACCOUNT_LOAD_FAILED",
  "STATE_RESTORE_REQUIRED",
]);

function describePledgeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && FEE_ESTIMATION_ERROR_CODES.has(code)) {
    return "Could not estimate fee. Check your connection and retry.";
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "The pledge could not be completed. Please try again.";
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
  onConnectWallet = async () => {},
  onDisconnectWallet = () => {},
  onPledge = async () => {},
  onClaim = async () => {},
  onSoftDelete = async () => {},
  onRefund = async () => {},
}: CampaignDetailPanelProps) {
  const [pledgeAmount, setPledgeAmount] = useState('25');
  const [refundContributor, setRefundContributor] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);

  useEffect(() => {

  }, [campaign?.id, connectedWallet]);

  const walletReady = Boolean(appConfig?.walletIntegrationReady ?? appConfig?.soroban?.enabled);

  if (isLoading) {
    return (
      <section className="card detail-panel">
        <div className="section-heading">
          <h2>
            <div className="skeleton skeleton-line" style={{ width: 220 }} />
          </h2>
          <div className="skeleton skeleton-line" style={{ width: 320, height: 14 }} />
        </div>
        <div className="detail-grid">
          {Array.from({ length: 4 }).map((_, index) => (
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
  async function submitPledge() {
    setPledgeError(null);
    setIsSubmitting(true);
    try {
      await onPledge(activeCampaign.id, Number(pledgeAmount), activeCampaign.assetCode);
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
    <section className="card detail-panel">
      <div className="section-heading">
        <h2>{activeCampaign.title}</h2>
        <p className="muted">{activeCampaign.description}</p>
      </div>

      <div className="wallet-status">
        <div>
          <h3 className="wallet-status-title">Wallet status</h3>
          <p className="muted">
            {connectedWallet
              ? `Connected to ${networkName(appConfig)}`
              : `Not connected — connect Freighter to take actions`}
          </p>
        </div>
        <div className="wallet-connected">
          {connectedWallet ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong className="mono">{connectedWallet.slice(0, 16)}...</strong>
                <CopyButton value={connectedWallet} ariaLabel="Copy connected wallet address" />
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
              {isConnectingWallet ? 'Connecting...' : 'Connect Freighter'}
            </button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <article className="detail-stat">
          <span>Creator</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong className="mono">{activeCampaign.creator.slice(0, 16)}...</strong>
            <CopyButton value={activeCampaign.creator} ariaLabel="Copy creator address" />
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
      </div>

      <ContributorSummary
        pledges={activeCampaign.pledges}
        assetCode={activeCampaign.assetCode}
        campaignId={activeCampaign.id}
        isLoading={isLoading}
      />

      {!walletReady ? (
        <p className="pending-note">
          Wallet integration is not fully configured yet. Freighter actions that require Soroban
          contract calls may stay disabled until backend config is set.
        </p>
      ) : null}

      <form className="form-grid" onSubmit={handlePledge}>
        <label className="field-group">
          <span>Connected contributor</span>
          <input
            type="text"
            value={connectedWallet ?? ''}
            placeholder="Connect Freighter to use the pledge flow"
            readOnly
          />
        </label>

        <label className="field-group">
          <span>Pledge amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={pledgeAmount}
            onChange={(event) => setPledgeAmount(event.target.value)}
            required
          />
        </label>

        <div className="action-row">
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
            {isPledgePending ? 'Submitting...' : 'Add pledge'}
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
          <div className="pledge-error" role="alert">
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
      </form>

      <div className="form-grid" style={{ marginTop: 16 }}>
        <label className="field-group">
          <span>Refund contributor</span>
          <input
            type="text"
            value={refundContributor}
            onChange={(event) => setRefundContributor(event.target.value)}
            placeholder="G... contributor public key"
          />
        </label>

        <div className="action-row">
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
        <p className="pending-note">
          The pledge transaction is in flight. Campaign state will refresh after the backend
          reconciles the result.
        </p>
      ) : null}

      {activeCampaign.metadata?.imageUrl ? (
        <CampaignImage url={activeCampaign.metadata.imageUrl} alt={activeCampaign.title} />
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
    </section>
  );
}
