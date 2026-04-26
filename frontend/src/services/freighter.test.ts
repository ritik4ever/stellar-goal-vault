import { beforeEach, describe, expect, it, vi } from "vitest";

const freighterMocks = vi.hoisted(() => ({
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("@stellar/freighter-api", () => freighterMocks);

import { amountToContractUnits, connectFreighterWallet } from "./freighter";

describe("freighter helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts display amounts into contract units", () => {
    expect(amountToContractUnits(25.5, 2)).toBe(2550n);
  });

  it("rejects precision that exceeds the configured decimals", () => {
    expect(() => amountToContractUnits(1.239, 2)).toThrow(/no more than 2 decimal places/i);
  });

  it("fails clearly when Freighter is unavailable", async () => {
    freighterMocks.isConnected.mockResolvedValue(false);

    await expect(
      connectFreighterWallet("Test SDF Network ; September 2015"),
    ).rejects.toMatchObject({
      code: "FREIGHTER_UNAVAILABLE",
    });
  });

  it("fails clearly when Freighter is on the wrong network", async () => {
    freighterMocks.isConnected.mockResolvedValue(true);
    freighterMocks.requestAccess.mockResolvedValue(`G${"A".repeat(55)}`);
    freighterMocks.getNetworkDetails.mockResolvedValue({
      network: "PUBLIC",
      networkUrl: "https://horizon.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      sorobanRpcUrl: "https://mainnet.rpc",
    });

    await expect(
      connectFreighterWallet("Test SDF Network ; September 2015"),
    ).rejects.toMatchObject({
      code: "FREIGHTER_NETWORK_MISMATCH",
    });
  });
});
