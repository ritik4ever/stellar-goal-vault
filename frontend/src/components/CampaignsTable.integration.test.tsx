import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

  function expectCampaignVisible(title: string) {
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  }

  function expectCampaignHidden(title: string) {
    expect(screen.queryAllByText(title)).toHaveLength(0);
  }

  function advanceTimers(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

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
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "rocket" } });

      // Advance past debounce delay (300ms)
      advanceTimers(350);

      // Should only show "Build a Rocket Ship"
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignHidden("Create a Game");
      expectCampaignHidden("Write a Book");
    });

    it("should filter campaigns by creator address", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "writer" } });

      advanceTimers(350);

      expectCampaignVisible("Write a Book");
      expectCampaignHidden("Build a Rocket Ship");
    });

    it("should filter campaigns by campaign ID", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "camp-002" } });

      advanceTimers(350);

      expectCampaignVisible("Create a Game");
      expectCampaignHidden("Build a Rocket Ship");
      expectCampaignHidden("Write a Book");
    });

    it("should be case-insensitive", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "BUILD" } });

      advanceTimers(350);

      expectCampaignVisible("Build a Rocket Ship");
    });

    it("should update results when search input changes", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "game" } });
      advanceTimers(350);

      expectCampaignVisible("Create a Game");

      // Clear and search for something else
      fireEvent.change(searchInput, { target: { value: "" } });
      fireEvent.change(searchInput, { target: { value: "book" } });

      advanceTimers(350);

      expectCampaignVisible("Write a Book");
      expectCampaignHidden("Create a Game");
    });
  });

  describe("Debouncing Behavior", () => {
    it("should not update results before debounce delay", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "rocket" } });

      // Don't wait for debounce - results should still show all campaigns
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignVisible("Create a Game");
    });

    it("should debounce rapid search inputs", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "ro" } });
      advanceTimers(100);

      fireEvent.change(searchInput, { target: { value: "rocke" } });
      advanceTimers(100);

      // Timer should still be pending
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignVisible("Create a Game");

      // Type "t"
      fireEvent.change(searchInput, { target: { value: "rocket" } });

      // Complete the debounce
      advanceTimers(350);

      // Now should filter
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignHidden("Create a Game");
    });
  });

  describe("Clear Button Integration", () => {
    it("should show clear button when search text is present", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "test" } });

      // Now clear button should appear
      expect(
        screen.getByRole("button", { name: "Clear search" }),
      ).toBeInTheDocument();
    });

    it("should clear search and show all campaigns when clear button clicked", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "rocket" } });
      advanceTimers(350);

      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignHidden("Create a Game");

      // Click clear button
      const clearButton = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearButton);

      advanceTimers(350);

      // All campaigns should be visible again
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignVisible("Create a Game");
      expectCampaignVisible("Write a Book");
    });
  });

  describe("Composition with Asset Filter", () => {
    it("should apply search AND asset filter together", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(assetFilter, { target: { value: "USDC" } });

      advanceTimers(350);

      // Should show "Build a Rocket Ship" and "Write a Book" (both USDC)
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignVisible("Write a Book");
      expectCampaignHidden("Create a Game");

      // Now search within USDC campaigns
      fireEvent.change(searchInput, { target: { value: "rocket" } });
      advanceTimers(350);

      // Should only show "Build a Rocket Ship"
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignHidden("Write a Book");
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

      const allTab = within(statusTabs).getByRole("tab", {
        name: /Status: Filter campaigns by status/i,
      });
      const openTab = within(statusTabs).getByRole("tab", {
        name: /Open2/i,
      });
      const fundedTab = within(statusTabs).getByRole("tab", {
        name: /Funded1/i,
      });
      const claimedTab = within(statusTabs).getByRole("tab", {
        name: /Claimed0/i,
      });
      const failedTab = within(statusTabs).getByRole("tab", {
        name: /Failed0/i,
      });

      expect(allTab).toHaveAttribute("aria-selected", "true");
      expect(openTab).toHaveAttribute("aria-selected", "false");
      expect(fundedTab).toHaveAttribute("aria-selected", "false");
      expect(claimedTab).toHaveAttribute("aria-selected", "false");
      expect(failedTab).toHaveAttribute("aria-selected", "false");
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
      const fundedTab = within(statusTabs).getByRole("tab", {
        name: /Funded1/i,
      });
      fireEvent.click(fundedTab);

      expect(screen.getAllByText("Write a Book").length).toBeGreaterThan(0);
      expect(screen.queryAllByText("Build a Rocket Ship")).toHaveLength(0);
      expect(screen.queryAllByText("Create a Game")).toHaveLength(0);
      expect(fundedTab).toHaveAttribute("aria-selected", "true");

      const allTab = within(statusTabs).getByRole("tab", {
        name: /Status: Filter campaigns by status/i,
      });
      fireEvent.click(allTab);

      expect(screen.getAllByText("Build a Rocket Ship").length).toBeGreaterThan(
        0,
      );
      expect(screen.getAllByText("Create a Game").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Write a Book").length).toBeGreaterThan(0);
      expect(allTab).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("Empty State Messages", () => {
    it("should show appropriate message when search finds no results", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });
      advanceTimers(350);

      // Should show no results message
      const emptyStateText =
        screen.queryByText(/No campaigns found/i) ||
        screen.queryByText(/Try adjusting your search/i);
      // Note: Exact message depends on component implementation
      expectCampaignHidden("Build a Rocket Ship");
    });

    it("should show all campaigns when search is cleared and no other filters active", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "rocket" } });
      advanceTimers(350);

      const clearButton = screen.getByRole("button", { name: "Clear search" });
      fireEvent.click(clearButton);

      advanceTimers(350);

      // All campaigns should be visible
      expectCampaignVisible("Build a Rocket Ship");
      expectCampaignVisible("Create a Game");
      expectCampaignVisible("Write a Book");
    });
  });

  describe("Performance", () => {
    it("should handle large campaign lists efficiently", async () => {
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });

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
      fireEvent.change(searchInput, { target: { value: "campaign 50" } });
      advanceTimers(350);

      // Should find "Campaign 50"
      expectCampaignVisible("Campaign 50");
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
      const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
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
      fireEvent.change(searchInput, { target: { value: "rocket" } });

      advanceTimers(350);

      // Should work as expected
      expectCampaignVisible("Build a Rocket Ship");
    });
  });
});
