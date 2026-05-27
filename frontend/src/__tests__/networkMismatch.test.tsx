import { vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { useFreighter } from "../hooks/useFreighter";

vi.mock("@stellar/freighter-api", async () => ({
  isConnected: vi.fn().mockResolvedValue(true),
  getNetworkDetails: vi.fn().mockResolvedValue({
    networkPassphrase: "Test SDF Network ; September 2015",
    sorobanRpcUrl: "https://testnet.rpc",
  }),
}));

vi.mock("../services/freighter", async () => {
  const actual: any = await vi.importActual("../services/freighter");
  return {
    ...actual,
    connectFreighterWallet: vi.fn().mockImplementation(() => {
      const error = new Error(
        "Freighter is connected to Stellar Mainnet, but this app expects Stellar Testnet.",
      ) as Error & { code?: string };
      error.code = "FREIGHTER_NETWORK_MISMATCH";
      return Promise.reject(error);
    }),
  };
});

test("shows network mismatch banner when Freighter is on the wrong network", async () => {
  function TestHarness() {
    const freighter = useFreighter();

    return (
      <div>
        {freighter.networkMismatch ? (
          <div>{freighter.networkMismatch.message}</div>
        ) : null}
        <button type="button" onClick={() => void freighter.connect("Test SDF Network ; September 2015")}>Connect</button>
      </div>
    );
  }

  render(<TestHarness />);

  const connectBtn = screen.getByRole("button", { name: /connect/i });
  await userEvent.click(connectBtn);

  await waitFor(() => {
    expect(screen.getByText(/Your wallet is on Mainnet but this app uses Testnet/i)).toBeInTheDocument();
  });
});
