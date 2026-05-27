import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CampaignDetailPanel } from "./CampaignDetailPanel";
import { AppConfig, Campaign } from "../types/campaign";

const mockConfig: AppConfig = {
  allowedAssets: ["USDC", "XLM"],
  soroban: {
    enabled: true,
    contractId: "C123",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://example.com",
  },
  sorobanRpcUrl: "https://example.com",
  contractId: "C123",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractAmountDecimals: 2,
  walletIntegrationReady: true,
  assetAddresses: {
    USDC: "CA6WSTPZ7RRCUC6H37CQFODG763XG2HXP2G6F367VCOGGVDP32P7665E",
    XLM: "CDLZFC3SYJYDZT7K3SSTH3YCUY6AFMCO3Y6S3G7FEYZNVNREK7Y6CYN5",
  },
};

const mockCampaign: Campaign = {
  id: "1",
  title: "Test Campaign",
  description: "A test campaign description",
  creator: `G${"A".repeat(55)}`,
  assetCode: "USDC",
  acceptedTokens: ["USDC"],
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

describe("CampaignDetailPanel", () => {
  test("shows empty state when campaign is null", () => {
    render(
      <CampaignDetailPanel campaign={null} appConfig={mockConfig} connectedWallet={null} />,
    );

    expect(screen.getByText(/pick a campaign/i)).toBeInTheDocument();
  });

  test("pressing Escape calls onClose and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <>
        <button>Campaign Card</button>
        <CampaignDetailPanel
          campaign={mockCampaign}
          appConfig={mockConfig}
          connectedWallet={null}
          onClose={onClose}
        />
      </>,
    );

    const card = screen.getByRole("button", { name: /campaign card/i });
    // focus the card before the panel mounts
    card.focus();
    expect(card).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(card).toHaveFocus();
  });
});
