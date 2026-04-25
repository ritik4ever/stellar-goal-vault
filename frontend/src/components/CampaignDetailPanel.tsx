
import { MousePointer2 } from "lucide-react";
import { AppConfig, Campaign } from "../types/campaign";
import { ContributorSummary } from "./ContributorSummary";
import { CopyButton } from "./CopyButton";
import { EmptyState } from "./EmptyState";

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  appConfig?: AppConfig | null;
  connectedWallet?: string | null;
  isConnectingWallet?: boolean;
  isLoading?: boolean;
  isPledgePending?: boolean;
  onConnectWallet?: () => Promise<void>;
  onPledge?: (campaignId: string, amount: number) => Promise<void>;
  onClaim?: (campaign: Campaign) => Promise<void>;
  onSoftDelete?: (campaignId: string) => Promise<void>;
  onRefund?: (campaignId: string, contributor: string) => Promise<void>;
}

function networkName(config: AppConfig | null | undefined): string {
  const passphrase = config?.networkPassphrase ?? config?.soroban?.networkPassphrase;

  if (!passphrase) {
    return "Configured network";
  }
  if (passphrase === "Test SDF Network ; September 2015") {
    return "Stellar Testnet";
  }
  if (passphrase === "Public Global Stellar Network ; September 2015") {
    return "Stellar Mainnet";
  }

  return "Configured network";
}

export function CampaignDetailPanel({
  campaign,
  appConfig,
  connectedWallet = null,
  isConnectingWallet = false,
  isLoading = false,
  isPledgePending = false,
  onConnectWallet = async () => {},
  onPledge = async () => {},
  onClaim?: (campaign: Campaign) => Promise<void>;
  onSoftDelete?: (campaignId: string) => Promise<void>;
  onRefund?: (campaignId: string, contributor: string) => Promise<void>;
}: CampaignDetailPanelProps) {
  const [pledgeAmount, setPledgeAmount] = useState("25");
  const [refundContributor, setRefundContributor] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingPledge, setIsConfirmingPledge] = useState(false);
  const [pendingPledgeDetails, setPendingPledgeDetails] = useState<
    | {
        amount: number;
        contributor: string;
      }
    | null
  >(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setPledgeAmount("25");
    setRefundContributor(connectedWallet ?? "");
  }, [campaign?.id, connectedWallet]);


  const walletReady = Boolean(
    appConfig?.walletIntegrationReady ?? appConfig?.soroban?.enabled,
  );

  if (isLoading) {
    return (
      <section className="card detail-panel">
        <div className="section-heading">
          <h2>
            <div className="skeleton skeleton-line" style={{ width: 220 }} />
          </h2>
          <div
            className="skeleton skeleton-line"
            style={{ width: 320, height: 14 }}
          />
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

  async function handlePledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(pledgeAmount);
    if (!connectedWallet || !Number.isFinite(amount) || amount <= 0) {
      return;
    }

    setPendingPledgeDetails({ amount, contributor: connectedWallet });
    setIsConfirmingPledge(true);
  }

  async function handleConfirmPledge() {
    if (!pendingPledgeDetails) {
      return;
    }

    setIsSubmitting(true);
    setIsConfirmingPledge(false);

    try {
      await onPledge(activeCampaign.id, pendingPledgeDetails.amount);
    } finally {
      setIsSubmitting(false);
      setPendingPledgeDetails(null);
    }
  }

  function handleCancelPledge() {
    setIsConfirmingPledge(false);
    setPendingPledgeDetails(null);
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
              : `Connect Freighter for ${networkName(appConfig)}`}
          </p>
        </div>
        <div className="wallet-connected">
          {connectedWallet ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong className="mono">{connectedWallet.slice(0, 16)}...</strong>
              <CopyButton
                value={connectedWallet}
                ariaLabel="Copy connected wallet address"
              />
            </div>
          ) : null}
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              void onConnectWallet();
            }}
            disabled={isSubmitting || isConnectingWallet}
          >
            {isConnectingWallet ? "Connecting..." : "Connect Freighter"}
          </button>
        </div>
      </div>

      <div className="detail-grid">
        <article className="detail-stat">
          <span>Creator</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        isLoading={isLoading}
      />

      {!walletReady ? (
        <p className="pending-note">
          Wallet integration is not fully configured yet. Freighter actions that
          require Soroban contract calls may stay disabled until backend config is set.
        </p>
      ) : null}

      <form className="form-grid" onSubmit={handlePledge}>
        <label className="field-group">
          <span>Connected contributor</span>
          <input
            type="text"
            value={connectedWallet ?? ""}
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
            {isPledgePending ? "Submitting..." : "Add pledge"}
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
      </form>

      {isConfirmingPledge && pendingPledgeDetails ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-pledge-title"
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            if (event.currentTarget === event.target) {
              handleCancelPledge();
            }
          }}
        >
          <div className="modal-panel">
            <h3 id="confirm-pledge-title">Confirm pledge</h3>
            <p className="muted">
              Review the pledge details before submitting your contribution.
            </p>
            <div className="modal-detail-list">
              <div className="modal-detail-item">
                <span>Campaign</span>
                <strong>{activeCampaign.title}</strong>
              </div>
              <div className="modal-detail-item">
                <span>Contributor</span>
                <strong className="mono">{pendingPledgeDetails.contributor}</strong>
              </div>
              <div className="modal-detail-item">
                <span>Amount</span>
                <strong>
                  {pendingPledgeDetails.amount} {activeCampaign.assetCode}
                </strong>
              </div>
            </div>
            <div className="action-row modal-actions">
              <button
                className="btn-ghost"
                type="button"
                onClick={handleCancelPledge}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={handleConfirmPledge}
                disabled={isSubmitting}
                ref={confirmButtonRef}
              >
                Confirm pledge
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
          The pledge transaction is in flight. Campaign state will refresh after
          the backend reconciles the result.
        </p>
      ) : null}

      {activeCampaign.metadata?.imageUrl ? (
        <div className="campaign-image-container">
          <img
            src={activeCampaign.metadata.imageUrl}
            alt={activeCampaign.title}
            className="campaign-image"
          />
        </div>
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
