import { describe, expect, it } from "vitest";
import { didCampaignBecomeFunded } from "./fundingCelebration";
import { Campaign } from "../types/campaign";

function buildCampaign(status: Campaign["progress"]["status"]): Campaign {
  return {
    id: "1",
    creator: `G${"A".repeat(55)}`,
    title: "Orbit Fund",
    description: "A campaign",
    assetCode: "USDC",
    targetAmount: 100,
    pledgedAmount: status === "funded" ? 100 : 50,
    deadline: 1_800_000_000,
    createdAt: 1_700_000_000,
    progress: {
      status,
      percentFunded: status === "funded" ? 100 : 50,
      remainingAmount: status === "funded" ? 0 : 50,
      pledgeCount: 1,
      hoursLeft: 12,
      canPledge: status === "open",
      canClaim: status === "funded",
      canRefund: status === "failed",
    },
  };
}

describe("didCampaignBecomeFunded", () => {
  it("returns true for an open to funded transition", () => {
    expect(didCampaignBecomeFunded(buildCampaign("open"), buildCampaign("funded"))).toBe(true);
  });

  it("returns false when the campaign was already funded", () => {
    expect(didCampaignBecomeFunded(buildCampaign("funded"), buildCampaign("funded"))).toBe(false);
  });

  it("returns false when there is no previous campaign snapshot", () => {
    expect(didCampaignBecomeFunded(null, buildCampaign("funded"))).toBe(false);
  });
});
