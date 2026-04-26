import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateCampaignForm } from "./CreateCampaignForm";
import { ApiError } from "../types/campaign";

describe("CreateCampaignForm", () => {
  const validCreator = `G${"A".repeat(55)}`;
  const validTitle = "My Test Campaign";
  const validDescription = "This campaign funds a real Soroban pledge flow for the MVP dashboard.";

  const fillValidForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(
      screen.getByPlaceholderText(/G\.\.\. creator public key/i),
      validCreator,
    );
    await user.type(
      screen.getByPlaceholderText(/Stellar community design sprint/i),
      validTitle,
    );
    await user.type(
      screen.getByPlaceholderText(/Describe what the campaign funds/i),
      validDescription,
    );
  };

  describe("Rendering", () => {
    it("renders all required fields", () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);
      
      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Stellar community design sprint/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Describe what the campaign funds/i)).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByLabelText(/target amount/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/deadline in hours/i)).toBeInTheDocument();
    });

    it("renders optional fields", () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);
      
      expect(screen.getByPlaceholderText(/https:\/\/example\.com\/image\.png/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/https:\/\/example\.com\/project/i)).toBeInTheDocument();
    });

    it("renders submit button", () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);
      
      expect(screen.getByRole("button", { name: /create campaign/i })).toBeInTheDocument();
    });

    it("uses default asset when no allowedAssets provided", () => {
      render(<CreateCampaignForm onCreate={async () => {}} />);
      
      const select = screen.getByRole("combobox");
      expect(select).toHaveValue("USDC");
    });

    it("renders allowed assets in dropdown", () => {
      render(
        <CreateCampaignForm
          onCreate={async () => {}}
          allowedAssets={["ARS", "USDC", "XLM"]}
        />,
      );
      
      const select = screen.getByRole("combobox");
      expect(select).toHaveValue("ARS");
      expect(screen.getByRole("option", { name: "ARS" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "USDC" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "XLM" })).toBeInTheDocument();
    });
  });

  describe("Field Validation - Creator Account", () => {
    it("shows error for empty creator account", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByPlaceholderText(/G\.\.\. creator public key/i);
      await user.click(input);
      await user.tab();

      expect(screen.getByText("Creator account is required")).toBeInTheDocument();
    });

    it("shows error for invalid creator account length", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        "GSHORT",
      );

      expect(screen.getByText("Stellar account must be exactly 56 characters")).toBeInTheDocument();
    });

    it("shows error for creator account not starting with G", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        `A${"A".repeat(55)}`,
      );

      expect(screen.getByText("Stellar account must start with 'G'")).toBeInTheDocument();
    });

    it("shows error for creator account with invalid characters", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        `G${"1".repeat(55)}`,
      );

      expect(screen.getByText(/Invalid Stellar account format/i)).toBeInTheDocument();
    });

    it("accepts valid creator account", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        validCreator,
      );

      expect(screen.queryByText(/Creator account is required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Stellar account must/i)).not.toBeInTheDocument();
    });
  });

  describe("Field Validation - Title", () => {
    it("shows error for empty title", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByPlaceholderText(/Stellar community design sprint/i);
      await user.click(input);
      await user.tab();

      expect(screen.getByText("Campaign title is required")).toBeInTheDocument();
    });

    it("shows error for title too short", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        "Hi",
      );

      expect(screen.getByText("Title must be at least 4 characters")).toBeInTheDocument();
    });

    it("shows error for title too long", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const titleInput = screen.getByPlaceholderText(/Stellar community design sprint/i);
      // Type 81 characters
      await user.type(titleInput, "A".repeat(81));

      expect(screen.getByText(/Title cannot exceed 80 characters/i)).toBeInTheDocument();
    });

    it("accepts valid title", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        validTitle,
      );

      expect(screen.queryByText(/Title is required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Title must be/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Title cannot exceed/i)).not.toBeInTheDocument();
    });
  });

  describe("Field Validation - Description", () => {
    it("shows error for empty description", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByPlaceholderText(/Describe what the campaign funds/i);
      await user.click(input);
      await user.tab();

      expect(screen.getByText("Campaign description is required")).toBeInTheDocument();
    });

    it("shows error for description too short", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        "Too short",
      );

      expect(screen.getByText("Description must be at least 20 characters")).toBeInTheDocument();
    });

    it("shows error for description too long", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const descInput = screen.getByPlaceholderText(/Describe what the campaign funds/i);
      // Type 501 characters - this may be slow, so use paste instead
      await user.click(descInput);
      await user.paste("A".repeat(501));

      expect(screen.getByText(/Description cannot exceed 500 characters/i)).toBeInTheDocument();
    }, 10000);

    it("accepts valid description", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        validDescription,
      );

      expect(screen.queryByText(/Description must be/i)).not.toBeInTheDocument();
    });
  });

  describe("Field Validation - Target Amount", () => {
    it("shows error for zero target amount", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/target amount/i);
      await user.clear(input);
      await user.type(input, "0");

      expect(screen.getByText("Amount must be greater than zero")).toBeInTheDocument();
    });

    it("shows error for negative target amount", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/target amount/i);
      await user.clear(input);
      await user.type(input, "-10");

      expect(screen.getByText("Amount must be greater than zero")).toBeInTheDocument();
    });

    it("shows error for target amount below minimum", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/target amount/i);
      await user.clear(input);
      await user.type(input, "0.001");

      expect(screen.getByText("Amount must be at least 0.01")).toBeInTheDocument();
    });

    it("accepts valid target amount", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/target amount/i);
      await user.clear(input);
      await user.type(input, "100");

      expect(screen.queryByText(/Amount must be/i)).not.toBeInTheDocument();
    });
  });

  describe("Field Validation - Deadline Hours", () => {
    it("shows error for deadline below minimum", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/deadline in hours/i);
      await user.clear(input);
      await user.type(input, "0.5");

      expect(screen.getByText("Deadline must be at least 1 hours")).toBeInTheDocument();
    });

    it("shows error for deadline exceeding maximum", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/deadline in hours/i);
      await user.clear(input);
      await user.type(input, "9000");

      expect(screen.getByText("Deadline cannot exceed 365 days")).toBeInTheDocument();
    });

    it("accepts valid deadline hours", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const input = screen.getByLabelText(/deadline in hours/i);
      await user.clear(input);
      await user.type(input, "48");

      expect(screen.queryByText(/Deadline is required/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Deadline must be/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Deadline cannot exceed/i)).not.toBeInTheDocument();
    });
  });

  describe("Form Submission - Valid Data", () => {
    it("calls onCreate with correct payload when form is valid", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const mockDate = new Date("2024-01-01T12:00:00Z");
      vi.setSystemTime(mockDate);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await fillValidForm(user);
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      const expectedDeadline = Math.floor(mockDate.getTime() / 1000) + 72 * 3600;
      expect(onCreate).toHaveBeenCalledWith({
        creator: validCreator,
        title: validTitle,
        description: validDescription,
        assetCode: "USDC",
        targetAmount: 250,
        deadline: expectedDeadline,
        metadata: {},
      });

      vi.useRealTimers();
    });

    it("includes optional metadata when provided", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await fillValidForm(user);
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/image\.png/i),
        "https://example.com/image.png",
      );
      await user.type(
        screen.getByPlaceholderText(/https:\/\/example\.com\/project/i),
        "https://example.com/project",
      );
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            imageUrl: "https://example.com/image.png",
            externalLink: "https://example.com/project",
          },
        }),
      );
    });

    it("trims whitespace from text fields", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        `  ${validCreator}  `,
      );
      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        `  ${validTitle}  `,
      );
      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        `  ${validDescription}  `,
      );
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          creator: validCreator,
          title: validTitle,
          description: validDescription,
        }),
      );
    });

    it("converts asset code to uppercase", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(
        <CreateCampaignForm
          onCreate={onCreate}
          allowedAssets={["usdc", "xlm"]}
        />,
      );

      await fillValidForm(user);
      await user.selectOptions(screen.getByRole("combobox"), "usdc");
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: "USDC",
        }),
      );
    });

    it("disables submit button while submitting", async () => {
      const user = userEvent.setup();
      let resolveCreate: () => void;
      const onCreate = vi.fn(() => new Promise<void>((resolve) => {
        resolveCreate = resolve;
      }));

      render(<CreateCampaignForm onCreate={onCreate} />);

      await fillValidForm(user);
      const submitButton = screen.getByRole("button", { name: /create campaign/i });
      
      await user.click(submitButton);

      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent("Creating...");

      resolveCreate!();
      await waitFor(() => {
        expect(submitButton).not.toBeDisabled();
      });
    });

    it("resets form after successful submission", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(
        <CreateCampaignForm
          onCreate={onCreate}
          allowedAssets={["ARS", "USDC"]}
        />,
      );

      await fillValidForm(user);
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(screen.getByPlaceholderText(/G\.\.\. creator public key/i)).toHaveValue("");
      expect(screen.getByPlaceholderText(/Stellar community design sprint/i)).toHaveValue("");
      expect(screen.getByPlaceholderText(/Describe what the campaign funds/i)).toHaveValue("");
      expect(screen.getByRole("combobox")).toHaveValue("ARS");
      expect(screen.getByLabelText(/target amount/i)).toHaveValue(250);
      expect(screen.getByLabelText(/deadline in hours/i)).toHaveValue(72);
    });
  });

  describe("Form Submission - Invalid Data", () => {
    it("does not call onCreate when form has validation errors", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        "INVALID",
      );
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      expect(onCreate).not.toHaveBeenCalled();
    });

    it("shows all validation errors on submit attempt", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      expect(screen.getByText("Creator account is required")).toBeInTheDocument();
      expect(screen.getByText("Campaign title is required")).toBeInTheDocument();
      expect(screen.getByText("Campaign description is required")).toBeInTheDocument();
    });

    it("disables submit button when form is invalid", async () => {
      const user = userEvent.setup();
      render(<CreateCampaignForm onCreate={async () => {}} />);

      const submitButton = screen.getByRole("button", { name: /create campaign/i });
      expect(submitButton).toBeDisabled();

      await fillValidForm(user);
      expect(submitButton).not.toBeDisabled();
    });

    it("prevents submission with invalid creator account", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(<CreateCampaignForm onCreate={onCreate} />);

      await user.type(
        screen.getByPlaceholderText(/G\.\.\. creator public key/i),
        "INVALID",
      );
      await user.type(
        screen.getByPlaceholderText(/Stellar community design sprint/i),
        validTitle,
      );
      await user.type(
        screen.getByPlaceholderText(/Describe what the campaign funds/i),
        validDescription,
      );
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      expect(onCreate).not.toHaveBeenCalled();
      expect(screen.getByText("Stellar account must be exactly 56 characters")).toBeInTheDocument();
    });
  });

  describe("API Error Handling", () => {
    it("displays API error message", () => {
      const apiError: ApiError = {
        message: "Something went wrong",
      };

      render(
        <CreateCampaignForm
          onCreate={async () => {}}
          apiError={apiError}
        />,
      );

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });

    it("displays API error with details", () => {
      const apiError: ApiError = {
        message: "Validation failed",
        details: [
          { field: "creator", message: "Invalid account" },
          { field: "title", message: "Title already exists" },
        ],
      };

      render(
        <CreateCampaignForm
          onCreate={async () => {}}
          apiError={apiError}
        />,
      );

      expect(screen.getByText("Validation failed")).toBeInTheDocument();
      expect(screen.getByText(/creator:/i)).toBeInTheDocument();
      expect(screen.getByText(/Invalid account/i)).toBeInTheDocument();
      expect(screen.getByText(/title:/i)).toBeInTheDocument();
      expect(screen.getByText(/Title already exists/i)).toBeInTheDocument();
    });

    it("displays API error with code and request ID", () => {
      const apiError: ApiError = {
        message: "Server error",
        code: "ERR_500",
        requestId: "req-123",
      };

      render(
        <CreateCampaignForm
          onCreate={async () => {}}
          apiError={apiError}
        />,
      );

      expect(screen.getByText("Server error")).toBeInTheDocument();
      expect(screen.getByText(/Code: ERR_500/i)).toBeInTheDocument();
      expect(screen.getByText(/Request ID: req-123/i)).toBeInTheDocument();
    });

    it("does not display error section when apiError is null", () => {
      render(
        <CreateCampaignForm
          onCreate={async () => {}}
          apiError={null}
        />,
      );

      expect(screen.queryByText(/Code:/i)).not.toBeInTheDocument();
    });
  });

  describe("Asset Selection", () => {
    it("updates asset code when selection changes", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn().mockResolvedValue(undefined);

      render(
        <CreateCampaignForm
          onCreate={onCreate}
          allowedAssets={["ARS", "USDC", "XLM"]}
        />,
      );

      await fillValidForm(user);
      await user.selectOptions(screen.getByRole("combobox"), "XLM");
      await user.click(screen.getByRole("button", { name: /create campaign/i }));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledTimes(1);
      });

      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: "XLM",
        }),
      );
    });

    it("resets to first allowed asset when allowedAssets changes", async () => {
      const { rerender } = render(
        <CreateCampaignForm
          onCreate={async () => {}}
          allowedAssets={["USDC", "XLM"]}
        />,
      );

      expect(screen.getByRole("combobox")).toHaveValue("USDC");

      rerender(
        <CreateCampaignForm
          onCreate={async () => {}}
          allowedAssets={["ARS", "BRL"]}
        />,
      );

      expect(screen.getByRole("combobox")).toHaveValue("ARS");
    });
  });
});
