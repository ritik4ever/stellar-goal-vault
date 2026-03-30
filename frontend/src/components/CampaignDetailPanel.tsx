import { FormEvent, useEffect, useState } from "react";
import { ContributorSummary } from "./ContributorSummary";
import { EmptyState } from "./EmptyState";

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  isLoading?: boolean;
  actionError?: ApiError | string | null;
  actionMessage?: string | null;
  isPledgePending?: boolean;
  onConnectWallet: () => Promise<void>;
  onPledge: (campaignId: string, amount: number) => Promise<void>;
  onClaim: (campaign: Campaign) => Promise<void>;
  onRefund: (campaignId: string, contributor: string) => Promise<void>;
}

function networkName(config: AppConfig | null): string {
  if (!config) {
    return "network";
  }
  if (config.networkPassphrase === "Test SDF Network ; September 2015") {
    return "Stellar Testnet";
  }
  if (
    config.networkPassphrase ===
    "Public Global Stellar Network ; September 2015"
  ) {
    return "Stellar Mainnet";
  }
  return "Configured network";
}

export function CampaignDetailPanel({
  campaign,
  appConfig,
  connectedWallet,
  isConnectingWallet = false,
  isLoading = false,
  actionError,
  actionMessage,
  isPledgePending = false,
  onConnectWallet,
  onPledge,
  onClaim,
  onRefund,
}: CampaignDetailPanelProps) {
  const [pledgeAmount, setPledgeAmount] = useState("25");
  const [refundContributor, setRefundContributor] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setPledgeAmount("25");
    setRefundContributor(connectedWallet ?? "");
  }, [campaign?.id, connectedWallet]);

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
  const normalizedActionError =
    typeof actionError === "string" ? ({ message: actionError } as ApiError) : actionError;

  async function handlePledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onPledge(activeCampaign.id, Number(pledgeAmount));
    } finally {
      setIsSubmitting(false);
    }
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

      <div className="detail-grid">
        <article className="detail-stat">
          <span>Creator</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong className="mono">
              {activeCampaign.creator.slice(0, 16)}...
            </strong>
            <CopyButton
              value={activeCampaign.creator}
              ariaLabel="Copy creator address"
            />
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
              !connectedWallet ||
              !walletReady
            }
          >
            {isPledgePending
              ? "Simulating / waiting..."
              : "Sign pledge with Freighter"}
          </button>

          <button
            className="btn-ghost"
            type="button"
            disabled={isSubmitting || !activeCampaign.progress.canClaim}
            onClick={handleClaim}
          >
            Claim vault
          </button>
        </div>
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
              contributor.trim().length === 0
            }
            onClick={handleRefund}
          >
            Refund contributor
          </button>
        </div>
      </div>

      {isPledgePending ? (
        <p className="pending-note">
          The pledge transaction is in flight. The local campaign state will
          refresh after the Soroban transaction confirms.
        </p>
      ) : null}
      {normalizedActionError ? (
        <div className="form-error">
          <p>{normalizedActionError.message}</p>
          {normalizedActionError.code && (
            <small className="error-meta">
              Code: {normalizedActionError.code}
              {normalizedActionError.requestId && ` | Request ID: ${normalizedActionError.requestId}`}
            </small>
          ) : null}
        </div>
      )}

      {actionMessage && <p className="form-success">{actionMessage}</p>}

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
