import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCampaignForm } from "./CreateCampaignForm";
import { vi } from "vitest";

describe("CreateCampaignForm Validation", () => {
  const mockOnCreate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Field Error Display", () => {
    it("displays creator account error for invalid Stellar address", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i);
      await user.type(creatorInput, "invalid");

      expect(
        screen.getByText(/Stellar account must be exactly 56 characters/i),
      ).toBeInTheDocument();
    });

    it("displays title error for too short title", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);
      await user.type(titleInput, "Bad");

      expect(
        screen.getByText(/at least 4 characters/i),
      ).toBeInTheDocument();
    });

    it("displays description error for too short description", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const descInput = screen.getByPlaceholderText(
        /Describe what the campaign funds/i,
      );
      await user.type(descInput, "Short");

      expect(
        screen.getByText(/at least 20 characters/i),
      ).toBeInTheDocument();
    });

    it("displays amount error for negative or zero amount", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const amountInputs = screen.getAllByDisplayValue("250");
      const amountInput = amountInputs[0]; // Target amount field

      await user.clear(amountInput);
      await user.type(amountInput, "0");

      expect(
        screen.getByText(/Amount must be greater than zero/i),
      ).toBeInTheDocument();
    });

    it("displays deadline error for zero hours", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const deadlineInputs = screen.getAllByDisplayValue("72");
      const deadlineInput = deadlineInputs[0]; // Deadline hours field

      await user.clear(deadlineInput);
      await user.type(deadlineInput, "0");

      expect(
        screen.getByText(/at least 1 hour/i),
      ).toBeInTheDocument();
    });
  });

  describe("Submit Button State", () => {
    it("disables submit button when form has validation errors", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const submitButton = screen.getByRole("button", { name: /Create campaign/i });

      // Initially disabled because form is empty
      expect(submitButton).toBeDisabled();

      // Add invalid data
      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i);
      await user.type(creatorInput, "invalid");

      // Button should still be disabled due to errors
      expect(submitButton).toBeDisabled();
    });

    it("enables submit button when all required fields are valid", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const submitButton = screen.getByRole("button", { name: /Create campaign/i });

      // Fill in valid data
      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        "G" + "A".repeat(55),
      );
      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        "My Valid Campaign Title",
      );
      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        "This is a valid campaign description with enough content.",
      );

      // Button should be enabled
      expect(submitButton).toBeEnabled();
    });
  });

  describe("Error Styling", () => {
    it("applies input-error class to fields with validation errors", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i) as HTMLInputElement;
      await user.type(creatorInput, "invalid");
      await user.type(creatorInput, "{Backspace}");

      expect(creatorInput).toHaveClass("input-error");
    });

    it("removes input-error class when field becomes valid", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const creatorInput = screen.getByPlaceholderText(/G\.\.\. creator public key/i) as HTMLInputElement;

      // Add invalid value
      await user.type(creatorInput, "invalid");
      expect(creatorInput).toHaveClass("input-error");

      // Clear and add valid value
      await user.clear(creatorInput);
      await user.type(creatorInput, "G" + "A".repeat(55));

      expect(creatorInput).not.toHaveClass("input-error");
      expect(screen.queryByText(/Invalid Stellar account format/i)).not.toBeInTheDocument();
    });
  });

  describe("Real-time Validation", () => {
    it("validates on field change, not just on submit", async () => {
      const user = userEvent.setup();
      render(
        <CreateCampaignForm
          onCreate={mockOnCreate}
          allowedAssets={["USDC"]}
        />,
      );

      const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);

      // Type too-short title
      await user.type(titleInput, "Bad");

      // Error should appear immediately
      expect(screen.getByText(/at least 4 characters/i)).toBeInTheDocument();

      // Add one more character
      await user.type(titleInput, "s");

      // Error should disappear
      expect(screen.queryByText(/at least 4 characters/i)).not.toBeInTheDocument();
    });
  });
});
