import { Campaign } from "../types/campaign";

export function didCampaignBecomeFunded(
  previousCampaign: Campaign | null | undefined,
  nextCampaign: Campaign | null | undefined,
): boolean {
  if (!previousCampaign || !nextCampaign) {
    return false;
  }

  return (
    previousCampaign.progress.status !== "funded" &&
    nextCampaign.progress.status === "funded"
  );
}
