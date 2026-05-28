import { useState, useEffect, useRef, memo } from "react";
import { Campaign } from "../types/campaign";
import { CopyButton } from "./CopyButton";
import { AddressAvatar } from "./AddressAvatar";

interface CampaignCardProps {
  campaign: Campaign;
  selectedCampaignId: string | null;
  onSelect: (campaignId: string) => void;
}

function areEqual(prevProps: CampaignCardProps, nextProps: CampaignCardProps): boolean {
  // Check if the card's specific selection status changed:
  const prevIsSelected = prevProps.selectedCampaignId === prevProps.campaign.id;
  const nextIsSelected = nextProps.selectedCampaignId === nextProps.campaign.id;
  if (prevIsSelected !== nextIsSelected) return false;

  // Check if selection callback function reference changed:
  if (prevProps.onSelect !== nextProps.onSelect) return false;

  // Check critical campaign fields (identity & mutable states):
  const prevC = prevProps.campaign;
  const nextC = nextProps.campaign;

  if (prevC.id !== nextC.id) return false;
  if (prevC.title !== nextC.title) return false;
  if (prevC.creator !== nextC.creator) return false;
  if (prevC.pledgedAmount !== nextC.pledgedAmount) return false;
  if (prevC.targetAmount !== nextC.targetAmount) return false;
  if (prevC.assetCode !== nextC.assetCode) return false;
  if (prevC.deadline !== nextC.deadline) return false;

  // Progress sub-fields:
  if (prevC.progress.pledgeCount !== nextC.progress.pledgeCount) return false;
  if (prevC.progress.percentFunded !== nextC.progress.percentFunded) return false;
  if (prevC.progress.status !== nextC.progress.status) return false;
  if (prevC.progress.hoursLeft !== nextC.progress.hoursLeft) return false;
  if (prevC.progress.canPledge !== nextC.progress.canPledge) return false;
  if (prevC.progress.canClaim !== nextC.progress.canClaim) return false;
  if (prevC.progress.canRefund !== nextC.progress.canRefund) return false;

  // Compare acceptedTokens:
  if (prevC.acceptedTokens !== nextC.acceptedTokens) {
    if (prevC.acceptedTokens.length !== nextC.acceptedTokens.length) return false;
    for (let i = 0; i < prevC.acceptedTokens.length; i++) {
      if (prevC.acceptedTokens[i] !== nextC.acceptedTokens[i]) return false;
    }
  }

  return true;
}

export function CampaignCardInner({
  campaign,
  selectedCampaignId,
  onSelect,
}: CampaignCardProps) {
  const prevPercentRef = useRef<number | null>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (prevPercentRef.current !== null && prevPercentRef.current !== campaign.progress.percentFunded) {
      setAnimate(true);
    }
    prevPercentRef.current = campaign.progress.percentFunded;
  }, [campaign.progress.percentFunded]);

  const formatTimestamp = (unixSeconds: number) =>
    new Date(unixSeconds * 1000).toLocaleString();

  return (
    <article
      className={`campaign-card ${selectedCampaignId === campaign.id ? "campaign-card-selected" : ""}`}
    >
      <div className="campaign-card-main">
        <div className="campaign-card-header">
          <div>
            <strong className="campaign-title">{campaign.title}</strong>
            <div className="muted">#{campaign.id}</div>
          </div>
          <div
            className="campaign-creator mono"
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <AddressAvatar address={campaign.creator} size={24} />
            <span>{campaign.creator.slice(0, 8)}...</span>
            <CopyButton
              value={campaign.creator}
              ariaLabel="Copy creator address"
              className="small"
            />
          </div>
        </div>

        <div className="campaign-progress">
          <div className="progress-copy">
            {campaign.pledgedAmount} / {campaign.targetAmount}{" "}
            {campaign.acceptedTokens?.length > 1 ? "Tokens" : campaign.assetCode}
          </div>
          <div className="progress-bar" aria-hidden>
            <div
              className={animate ? "progress-bar-fill" : undefined}
              style={{
                width: `${Math.min(campaign.progress.percentFunded, 100)}%`,
              }}
            />
          </div>
          <div className="muted">{campaign.progress.percentFunded}% funded</div>
        </div>

        <div className="campaign-meta">
          <span className={`badge badge-${campaign.progress.status}`}>
            {campaign.progress.status}
          </span>
          <div className="muted">{formatTimestamp(campaign.deadline)}</div>
        </div>
      </div>

      <div className="campaign-card-actions">
        <button
          className={
            selectedCampaignId === campaign.id ? "btn-secondary" : "btn-primary"
          }
          type="button"
          onClick={() => onSelect(campaign.id)}
        >
          {selectedCampaignId === campaign.id ? "Selected" : "Manage"}
        </button>
      </div>
    </article>
  );
}

export const CampaignCard = memo(CampaignCardInner, areEqual);

export default CampaignCard;
