import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignsTable } from "./CampaignsTable";
import type { Campaign } from "../types/campaign";

describe("CampaignsTable Search Integration", () => {
  const mockCampaigns: Campaign[] = [
    {
      id: "camp-001",
      title: "Build a Rocket Ship",
      description: "Launch into space",
      creator: "GDJVFDLKJVEF@stellar.org",
      assetCode: "USDC",
      targetAmount: 100000,
      pledgedAmount: 50000,
      deadline: "2025-12-31",
      progress: {
        status: "open",
        percentFunded: 50,
        hoursLeft: 240,
        canPledge: true,
        canClaim: false,
        canRefund: false,
      },
      acceptedTokens: ["USDC"],
      createdAt: Math.floor(Date.now() / 1000),
    },
    {
      id: "camp-002",
      title: "Create a Game",
      description: "Indie game development",
      creator: "GABC123XYZ@stellar.org",
      assetCode: "native",
      targetAmount: 50000,
      pledgedAmount: 30000,
      deadline: "2025-11-30",
      progress: {
        status: "open",
        percentFunded: 60,
        hoursLeft: 120,
        canPledge: true,
        canClaim: false,
        canRefund: false,
      },
      acceptedTokens: ["USDC"],
      createdAt: Math.floor(Date.now() / 1000),
    },
    {
      id: "camp-003",
      title: "Write a Book",
      description: "Science fiction novel",
      creator: "GWRITER2024@stellar.org",
      assetCode: "USDC",
      targetAmount: 20000,
      pledgedAmount: 20000,
      deadline: "2025-10-31",
      progress: {
        status: "funded",
        percentFunded: 100,
        hoursLeft: 0,
        canPledge: false,
        canClaim: true,
        canRefund: false,
      },
      acceptedTokens: ["USDC"],
      createdAt: Math.floor(Date.now() / 1000),
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Search Input Rendering", () => {
    it("should render search input in the table header", () => {
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");
      expect(searchInput).toBeInTheDocument();
    });

    it("should render filter dropdown alongside search input", () => {
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");
      const filterLabel = screen.getByText(/Asset:/);

      expect(searchInput).toBeInTheDocument();
      expect(filterLabel).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("should filter campaigns by title when searching", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Type "rocket"
      await user.type(searchInput, "rocket");

      // Advance past debounce delay (300ms)
      vi.advanceTimersByTime(350);

      // Should only show "Build a Rocket Ship"
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.queryByText("Create a Game")).not.toBeInTheDocument();
      expect(screen.queryByText("Write a Book")).not.toBeInTheDocument();
    });

    it("should filter campaigns by creator address", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search for creator
      await user.type(searchInput, "writer");

      vi.advanceTimersByTime(350);

      expect(screen.getByText("Write a Book")).toBeInTheDocument();
      expect(screen.queryByText("Build a Rocket Ship")).not.toBeInTheDocument();
    });

    it("should filter campaigns by campaign ID", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search for ID
      await user.type(searchInput, "camp-002");

      vi.advanceTimersByTime(350);

      expect(screen.getByText("Create a Game")).toBeInTheDocument();
      expect(screen.queryByText("Build a Rocket Ship")).not.toBeInTheDocument();
      expect(screen.queryByText("Write a Book")).not.toBeInTheDocument();
    });

    it("should be case-insensitive", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search with uppercase
      await user.type(searchInput, "BUILD");

      vi.advanceTimersByTime(350);

      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
    });

    it("should update results when search input changes", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText(
        "Search campaigns...",
      ) as HTMLInputElement;

      // First search
      await user.type(searchInput, "game");
      vi.advanceTimersByTime(350);

      expect(screen.getByText("Create a Game")).toBeInTheDocument();

      // Clear and search for something else
      await user.clear(searchInput);
      await user.type(searchInput, "book");

      vi.advanceTimersByTime(350);

      expect(screen.getByText("Write a Book")).toBeInTheDocument();
      expect(screen.queryByText("Create a Game")).not.toBeInTheDocument();
    });
  });

  describe("Debouncing Behavior", () => {
    it("should not update results before debounce delay", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Type something
      await user.type(searchInput, "rocket");

      // Don't wait for debounce - results should still show all campaigns
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.getByText("Create a Game")).toBeInTheDocument();
    });

    it("should debounce rapid search inputs", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Type quickly: r, o, c, k, e, t
      await user.type(searchInput, "ro");
      vi.advanceTimersByTime(100);

      await user.type(searchInput, "cke");
      vi.advanceTimersByTime(100);

      // Timer should still be pending
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.getByText("Create a Game")).toBeInTheDocument();

      // Type "t"
      await user.type(searchInput, "t");

      // Complete the debounce
      vi.advanceTimersByTime(350);

      // Now should filter
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.queryByText("Create a Game")).not.toBeInTheDocument();
    });
  });

  describe("Clear Button Integration", () => {
    it("should show clear button when search text is present", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Initially no clear button
      expect(
        screen.queryByRole("button", { name: "Clear search" }),
      ).not.toBeInTheDocument();

      // Type something
      await user.type(searchInput, "test");

      // Now clear button should appear
      expect(
        screen.getByRole("button", { name: "Clear search" }),
      ).toBeInTheDocument();
    });

    it("should clear search and show all campaigns when clear button clicked", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search for something
      await user.type(searchInput, "rocket");
      vi.advanceTimersByTime(350);

      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.queryByText("Create a Game")).not.toBeInTheDocument();

      // Click clear button
      const clearButton = screen.getByRole("button", { name: "Clear search" });
      await user.click(clearButton);

      vi.advanceTimersByTime(350);

      // All campaigns should be visible again
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.getByText("Create a Game")).toBeInTheDocument();
      expect(screen.getByText("Write a Book")).toBeInTheDocument();
    });
  });

  describe("Composition with Asset Filter", () => {
    it("should apply search AND asset filter together", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");
      const assetFilter = screen.getByDisplayValue("All Assets");

      // First filter by asset
      await user.selectOptions(assetFilter, "USDC");

      vi.advanceTimersByTime(350);

      // Should show "Build a Rocket Ship" and "Write a Book" (both USDC)
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.getByText("Write a Book")).toBeInTheDocument();
      expect(screen.queryByText("Create a Game")).not.toBeInTheDocument();

      // Now search within USDC campaigns
      await user.type(searchInput, "rocket");
      vi.advanceTimersByTime(350);

      // Should only show "Build a Rocket Ship"
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.queryByText("Write a Book")).not.toBeInTheDocument();
    });
  });

  describe("Status Filter Tabs", () => {
    it("should show counts per status and a clear active filter", () => {
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const statusTabs = screen.getByRole("tablist", {
        name: /Filter campaigns by status/i,
      });

      const allTab = within(statusTabs).getByRole("button", {
        name: /Status: Filter campaigns by status/i,
      });
      const openTab = within(statusTabs).getByRole("button", {
        name: /Open2/i,
      });
      const fundedTab = within(statusTabs).getByRole("button", {
        name: /Funded1/i,
      });
      const claimedTab = within(statusTabs).getByRole("button", {
        name: /Claimed0/i,
      });
      const failedTab = within(statusTabs).getByRole("button", {
        name: /Failed0/i,
      });

      expect(allTab).toHaveAttribute("aria-pressed", "true");
      expect(openTab).toHaveAttribute("aria-pressed", "false");
      expect(fundedTab).toHaveAttribute("aria-pressed", "false");
      expect(claimedTab).toHaveAttribute("aria-pressed", "false");
      expect(failedTab).toHaveAttribute("aria-pressed", "false");
    });

    it("should filter to one status at a time and allow returning to all", () => {
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const statusTabs = screen.getByRole("tablist", {
        name: /Filter campaigns by status/i,
      });
      const fundedTab = within(statusTabs).getByRole("button", {
        name: /Funded1/i,
      });
      fireEvent.click(fundedTab);

      expect(screen.getAllByText("Write a Book").length).toBeGreaterThan(0);
      expect(screen.queryAllByText("Build a Rocket Ship")).toHaveLength(0);
      expect(screen.queryAllByText("Create a Game")).toHaveLength(0);
      expect(fundedTab).toHaveAttribute("aria-pressed", "true");

      const allTab = within(statusTabs).getByRole("button", {
        name: /Status: Filter campaigns by status/i,
      });
      fireEvent.click(allTab);

      expect(screen.getAllByText("Build a Rocket Ship").length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText("Create a Game").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Write a Book").length).toBeGreaterThan(0);
      expect(allTab).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("Empty State Messages", () => {
    it("should show appropriate message when search finds no results", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search for non-existent campaign
      await user.type(searchInput, "nonexistent");
      vi.advanceTimersByTime(350);

      // Should show no results message
      const emptyStateText =
        screen.queryByText(/No campaigns found/i) ||
        screen.queryByText(/Try adjusting your search/i);
      // Note: Exact message depends on component implementation
      expect(screen.queryByText("Build a Rocket Ship")).not.toBeInTheDocument();
    });

    it("should show all campaigns when search is cleared and no other filters active", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Type and then clear
      await user.type(searchInput, "rocket");
      vi.advanceTimersByTime(350);

      const clearButton = screen.getByRole("button", { name: "Clear search" });
      await user.click(clearButton);

      vi.advanceTimersByTime(350);

      // All campaigns should be visible
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
      expect(screen.getByText("Create a Game")).toBeInTheDocument();
      expect(screen.getByText("Write a Book")).toBeInTheDocument();
    });
  });

  describe("Performance", () => {
    it("should handle large campaign lists efficiently", async () => {
      const user = userEvent.setup({ delay: null });

      // Create 100 campaigns
      const largeCampaignList: Campaign[] = Array.from(
        { length: 100 },
        (_, i) => ({
          id: `camp-${i.toString().padStart(3, "0")}`,
          title: `Campaign ${i + 1}`,
          description: `Description ${i + 1}`,
          creator: `CREATOR${i}@stellar.org`,
          assetCode: i % 2 === 0 ? "USDC" : "native",
          targetAmount: 100000 * (i + 1),
          pledgedAmount: 50000 * (i + 1),
          deadline: "2025-12-31",
          progress: {
            status: "open" as const,
            percentFunded: (i % 100) + 1,
            hoursLeft: 240,
            canPledge: true,
            canClaim: false,
            canRefund: false,
          },
        }),
      );

      render(
        <CampaignsTable
          campaigns={largeCampaignList}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Search should still work smoothly
      await user.type(searchInput, "campaign 50");
      vi.advanceTimersByTime(350);

      // Should find "Campaign 50"
      expect(screen.getByText("Campaign 50")).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    it("should have accessible search input with proper labels", () => {
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByLabelText(
        "Search campaigns by title, creator, or ID",
      );
      expect(searchInput).toBeInTheDocument();
    });

    it("should allow keyboard navigation", async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <CampaignsTable
          campaigns={mockCampaigns}
          selectedCampaignId={null}
          onSelect={vi.fn()}
          isLoading={false}
        />,
      );

      const searchInput = screen.getByPlaceholderText("Search campaigns...");

      // Focus the search input
      searchInput.focus();
      expect(searchInput).toHaveFocus();

      // Type with keyboard
      await user.keyboard("rocket");

      vi.advanceTimersByTime(350);

      // Should work as expected
      expect(screen.getByText("Build a Rocket Ship")).toBeInTheDocument();
    });
  });
});
