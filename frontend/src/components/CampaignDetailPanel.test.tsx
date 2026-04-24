import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CampaignDetailPanel } from "./CampaignDetailPanel";
import { Campaign } from "../types/campaign";

const mockCampaign: Campaign = {
  id: "1",
  title: "Test Campaign",
  description: "A test campaign description",
  creator: `G${"A".repeat(55)}`,
  assetCode: "USDC",
  targetAmount: 100,
  pledgedAmount: 0,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  createdAt: Math.floor(Date.now() / 1000),
  pledges: [],
  progress: {
    status: "open",
    percentFunded: 0,
    remainingAmount: 100,
    hoursLeft: 1,
    pledgeCount: 0,
    canPledge: true,
    canClaim: false,
    canRefund: false,
  },
  metadata: {},
};

const mockConfig = {
  allowedAssets: ["USDC", "XLM"],
  soroban: {
    enabled: false,
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "",
  },
  sorobanRpcUrl: "",
  contractId: "",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractAmountDecimals: 2,
  walletIntegrationReady: false,
};

describe("CampaignDetailPanel", () => {
  it("shows empty state when no campaign selected",async () => {
    render(
      <CampaignDetailPanel
        campaign={null}
        appConfig={mockConfig}
        connectedWallet={null}
        onConnectWallet={async () => {}}
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />,
    );

    expect(screen.getByText(/Pick a campaign/i)).toBeInTheDocument();
  });

  it("renders campaign details when campaign is selected", () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={null}
        onConnectWallet={async () => {}}
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />,
    );
    expect(screen.getByText("Test Campaign")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("calls onPledge when form is submitted", async () => {
    const user = userEvent.setup();
    const onPledge = vi.fn().mockResolvedValue(undefined);

    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={`G${"B".repeat(55)}`}
        onConnectWallet={async () => {}}
        onPledge={onPledge}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />,
    );

    await user.click(screen.getByText("Add pledge"));
    expect(onPledge).toHaveBeenCalled();
  });

  it("shows pending note while pledge is in flight", () => {
    render(
      <CampaignDetailPanel
        campaign={mockCampaign}
        appConfig={mockConfig}
        connectedWallet={`G${"B".repeat(55)}`}
        isPledgePending
        onConnectWallet={async () => {}}
        onPledge={async () => {}}
        onClaim={async () => {}}
        onRefund={async () => {}}
      />,
    );

    expect(screen.getByText(/pledge transaction is in flight/i)).toBeInTheDocument();
  });
});
