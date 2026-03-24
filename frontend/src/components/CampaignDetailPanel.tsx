import { FormEvent, useEffect, useState } from "react";
import { Campaign } from "../types/campaign";
import { ContributorSummary } from "./ContributorSummary";

interface CampaignDetailPanelProps {
  campaign: Campaign | null;
  actionError?: string | null;
  actionMessage?: string | null;
  isPledgePending?: boolean;
  onPledge: (campaignId: string, contributor: string, amount: number) => Promise<void>;
  onClaim: (campaign: Campaign) => Promise<void>;
  onRefund: (campaignId: string, contributor: string) => Promise<void>;
}

export function CampaignDetailPanel({
  campaign,
  actionError,
  actionMessage,
  isPledgePending = false,
  onPledge,
  onClaim,
  onRefund,
}: CampaignDetailPanelProps) {
  const [contributor, setContributor] = useState("");
  const [amount, setAmount] = useState("25");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setContributor("");
    setAmount("25");
  }, [campaign?.id]);

  if (!campaign) {
    return <section className="card empty-state">Pick a campaign from the board to manage it.</section>;
  }

  const activeCampaign = campaign;

  async function handlePledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onPledge(activeCampaign.id, contributor.trim(), Number(amount));
      setAmount("25");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefund() {
    setIsSubmitting(true);
    try {
      await onRefund(activeCampaign.id, contributor.trim());
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
          <strong className="mono">{activeCampaign.creator.slice(0, 16)}...</strong>
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

      <ContributorSummary pledges={activeCampaign.pledges} assetCode={activeCampaign.assetCode} />

      <form className="form-grid" onSubmit={handlePledge}>
        <label className="field-group">
          <span>Contributor account</span>
          <input
            type="text"
            value={contributor}
            onChange={(event) => setContributor(event.target.value)}
            placeholder="G... contributor public key"
            required
          />
        </label>

        <label className="field-group">
          <span>Pledge amount</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
        </label>

        <div className="action-row">
          <button
            className="btn-primary"
            type="submit"
            disabled={isSubmitting || !activeCampaign.progress.canPledge}
          >
            {isPledgePending ? "Submitting..." : "Add pledge"}
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={isSubmitting || !activeCampaign.progress.canClaim}
            onClick={handleClaim}
          >
            Claim vault
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={isSubmitting || !activeCampaign.progress.canRefund || contributor.trim().length === 0}
            onClick={handleRefund}
          >
            Refund contributor
          </button>
        </div>
      </form>

      {isPledgePending ? (
        <p className="pending-note">Pledge is pending confirmation and will reconcile automatically.</p>
      ) : null}
      {actionError ? <p className="form-error">{actionError}</p> : null}
      {actionMessage ? <p className="form-success">{actionMessage}</p> : null}
    </section>
  );
}
