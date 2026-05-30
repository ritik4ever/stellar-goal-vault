import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  TransactionPreviewModal,
  TransactionPreviewData,
} from "./TransactionPreviewModal";

describe("TransactionPreviewModal", () => {
  const basePreview: TransactionPreviewData = {
    operation: "contribute",
    amount: 25,
    contract: "CA3D5K7U5H4Q7Z2X9Y1R6N8P0M4Q2L8K3J1H5G7F9D2S4A6W8E0R1T3Y5U",
    xdr: "AAAAAgAAAAB...truncated",
  };

  it("renders operation, amount, and contract", () => {
    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("contribute")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
    expect(
      screen.getByText(/CA3D5K7U5H4Q7Z2X9Y1R6N8P0M4Q2L8K3J1H5G7F9D2S4A6W8E0R1T3Y5U/),
    ).toBeTruthy();
  });

  it("shows default fee of 0 stroops when no fee data provided", () => {
    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/0\.000000 XLM \(0 stroops\)/)).toBeTruthy();
  });

  it("displays estimated fee in XLM and stroops when provided", () => {
    const previewWithFee: TransactionPreviewData = {
      ...basePreview,
      estimatedFeeStroops: 104_500,
    };

    render(
      <TransactionPreviewModal
        preview={previewWithFee}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("104500 stroops")).toBeTruthy();
    expect(screen.getByText(/0\.010450 XLM/)).toBeTruthy();
  });

  it("renders a custom estimatedFeeXlm string when provided", () => {
    const previewWithCustomFee: TransactionPreviewData = {
      ...basePreview,
      estimatedFeeStroops: 500,
      estimatedFeeXlm: "0.00005",
    };

    render(
      <TransactionPreviewModal
        preview={previewWithCustomFee}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("500 stroops")).toBeTruthy();
    expect(screen.getByText("0.00005 XLM")).toBeTruthy();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Confirm and Sign"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("toggles XDR display", async () => {
    const user = userEvent.setup();

    render(
      <TransactionPreviewModal
        preview={basePreview}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText("Show raw XDR");
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/AAAAAgAAAAB...truncated/)).toBeTruthy();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
