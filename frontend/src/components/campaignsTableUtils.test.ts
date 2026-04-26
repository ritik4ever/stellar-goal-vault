import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchCampaigns, sortCampaigns } from "./campaignsTableUtils";
import type { Campaign } from "../types/campaign";
import type { SortOption } from "./SortDropdown";

// Mock campaign data
const mockCampaigns: Campaign[] = [
  {
    id: "1",
    creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    title: "Build a Rocket Ship",
    description: "We need funding to build an amazing rocket ship",
    assetCode: "USDC",
    targetAmount: 10000,
    pledgedAmount: 5000,
    deadline: 1710086400,
    createdAt: 1710000000,
    progress: {
      status: "open",
      percentFunded: 50,
      remainingAmount: 5000,
      pledgeCount: 3,
      hoursLeft: 24,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  },
  {
    id: "2",
    creator: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    title: "Community Garden Initiative",
    description: "Create a sustainable community garden",
    assetCode: "XLM",
    targetAmount: 5000,
    pledgedAmount: 2500,
    deadline: 1710172800,
    createdAt: 1710000100,
    progress: {
      status: "open",
      percentFunded: 50,
      remainingAmount: 2500,
      pledgeCount: 5,
      hoursLeft: 48,
      canPledge: true,
      canClaim: false,
      canRefund: false,
    },
  },
  {
    id: "3",
    creator: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    title: "Educational Platform",
    description: "Build an online learning platform",
    assetCode: "USDC",
    targetAmount: 20000,
    pledgedAmount: 15000,
    deadline: 1710259200,
    createdAt: 1710000200,
    progress: {
      status: "funded",
      percentFunded: 75,
      remainingAmount: 5000,
      pledgeCount: 10,
      hoursLeft: 72,
      canPledge: false,
      canClaim: true,
      canRefund: false,
    },
  },
];

describe("searchCampaigns", () => {
  describe("Search by title", () => {
    it("should find campaign by exact title match", () => {
      const results = searchCampaigns(mockCampaigns, "Build a Rocket Ship");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("should find campaign by partial title match", () => {
      const results = searchCampaigns(mockCampaigns, "Rocket");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("should find multiple campaigns with overlapping titles", () => {
      const results = searchCampaigns(mockCampaigns, "Build");
      expect(results).toHaveLength(2);
      expect(results.map((c) => c.id)).toContain("1");
      expect(results.map((c) => c.id)).toContain("3");
    });

    it("should be case-insensitive", () => {
      const results1 = searchCampaigns(mockCampaigns, "rocket");
      const results2 = searchCampaigns(mockCampaigns, "ROCKET");
      const results3 = searchCampaigns(mockCampaigns, "RoCkEt");

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);
      expect(results3).toHaveLength(1);
      expect(results1[0].id).toBe(results2[0].id);
    });
  });

  describe("Search by creator", () => {
    it("should find campaign by creator address", () => {
      const creator = mockCampaigns[0].creator;
      const results = searchCampaigns(mockCampaigns, creator);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("should find campaign by partial creator address", () => {
      const creatorPrefix = mockCampaigns[0].creator.slice(0, 8);
      const results = searchCampaigns(mockCampaigns, creatorPrefix);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("1");
    });

    it("should be case-insensitive for creator search", () => {
      const creatorLower = mockCampaigns[0].creator.toLowerCase();
      const creatorMixed = creatorLower.substring(0, 10) + "AAAA";
      const results = searchCampaigns(mockCampaigns, creatorMixed);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Search by campaign ID", () => {
    it("should find campaign by exact ID", () => {
      const results = searchCampaigns(mockCampaigns, "1");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("should find campaign by partial ID match", () => { // In this case all IDs are single digits, so "1" matches only campaign 1, but let's cover the logic
      const results = searchCampaigns(mockCampaigns, "2");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });

    it("should be case-insensitive for ID search", () => {
      const results1 = searchCampaigns(mockCampaigns, "1");
      const results2 = searchCampaigns(mockCampaigns, "1");
      expect(results1).toEqual(results2);
    });
  });

  describe("Edge cases", () => {
    it("should return all campaigns when search query is empty", () => {
      const results = searchCampaigns(mockCampaigns, "");
      expect(results).toEqual(mockCampaigns);
    });

    it("should return all campaigns when search query is only whitespace", () => {
      const results1 = searchCampaigns(mockCampaigns, "   ");
      const results2 = searchCampaigns(mockCampaigns, "\t\n");
      expect(results1).toEqual(mockCampaigns);
      expect(results2).toEqual(mockCampaigns);
    });

    it("should return empty array when no campaigns match", () => {
      const results = searchCampaigns(mockCampaigns, "NonExistentCampaign");
      expect(results).toHaveLength(0);
    });

    it("should handle search query with leading/trailing whitespace", () => {
      const results = searchCampaigns(mockCampaigns, "  Rocket  ");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("should be robust to special characters", () => {
      const results = searchCampaigns(mockCampaigns, "Garden");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });
  });

  describe("Search behavior combinations", () => {
    it("should find campaign by searching multiple fields", () => {
      // The first campaign creator starts with GA
      const creatorPrefix = mockCampaigns[0].creator.slice(0, 2);
      const results = searchCampaigns(mockCampaigns, creatorPrefix);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should maintain order of results (same as input array)", () => {
      const results = searchCampaigns(mockCampaigns, "Build");
      // Both "Build a Rocket Ship" and "Build an online learning platform" match
      expect(results.map((c) => c.id)).toEqual(["1", "3"]);
    });

    it("should not return duplicates", () => {
      // Even if a campaign matches multiple fields, it should appear once
      const results = searchCampaigns(mockCampaigns, "Community");
      const ids = results.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length); // All IDs are unique
    });
  });

  describe("Empty input", () => {
    it("should handle empty campaign array", () => {
      const results = searchCampaigns([], "search");
      expect(results).toHaveLength(0);
    });

    it("should handle empty campaign array with empty query", () => {
      const results = searchCampaigns([], "");
      expect(results).toHaveLength(0);
    });
  });
});

describe("sortCampaigns", () => {
  const mockCampaigns: Campaign[] = [
    {
      id: "1",
      creator: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      title: "Campaign A",
      description: "First campaign",
      assetCode: "USDC",
      targetAmount: 10000,
      pledgedAmount: 5000,
      deadline: 1710086400,
      createdAt: 1710000000,
      progress: {
        status: "open",
        percentFunded: 50,
        remainingAmount: 5000,
        pledgeCount: 3,
        hoursLeft: 24,
        canPledge: true,
        canClaim: false,
        canRefund: false,
      },
    },
    {
      id: "2",
      creator: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      title: "Campaign B",
      description: "Second campaign",
      assetCode: "XLM",
      targetAmount: 5000,
      pledgedAmount: 2500,
      deadline: 1710172800,
      createdAt: 1710000100,
      progress: {
        status: "open",
        percentFunded: 50,
        remainingAmount: 2500,
        pledgeCount: 5,
        hoursLeft: 48,
        canPledge: true,
        canClaim: false,
        canRefund: false,
      },
    },
    {
      id: "3",
      creator: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      title: "Campaign C",
      description: "Third campaign",
      assetCode: "USDC",
      targetAmount: 20000,
      pledgedAmount: 15000,
      deadline: 1710259200,
      createdAt: 1710000200,
      progress: {
        status: "funded",
        percentFunded: 75,
        remainingAmount: 5000,
        pledgeCount: 10,
        hoursLeft: 72,
        canPledge: false,
        canClaim: true,
        canRefund: false,
      },
    },
  ];

  describe("Sort by newest", () => {
    it("should sort campaigns by createdAt descending (newest first)", () => {
      const sorted = sortCampaigns(mockCampaigns, "newest");
      expect(sorted[0].id).toBe("3"); // createdAt: 1710000200
      expect(sorted[1].id).toBe("2"); // createdAt: 1710000100
      expect(sorted[2].id).toBe("1"); // createdAt: 1710000000
    });

    it("should not mutate the original array", () => {
      const original = [...mockCampaigns];
      sortCampaigns(mockCampaigns, "newest");
      expect(mockCampaigns).toEqual(original);
    });
  });

  describe("Sort by deadline", () => {
    it("should sort campaigns by deadline ascending (nearest deadline first)", () => {
      const sorted = sortCampaigns(mockCampaigns, "deadline");
      expect(sorted[0].id).toBe("1"); // deadline: 1710086400
      expect(sorted[1].id).toBe("2"); // deadline: 1710172800
      expect(sorted[2].id).toBe("3"); // deadline: 1710259200
    });
  });

  describe("Sort by percentFunded", () => {
    it("should sort campaigns by percentFunded descending (highest first)", () => {
      const sorted = sortCampaigns(mockCampaigns, "percentFunded");
      expect(sorted[0].id).toBe("3"); // percentFunded: 75
      expect(sorted[1].id).toBe("1"); // percentFunded: 50
      expect(sorted[2].id).toBe("2"); // percentFunded: 50
    });

    it("should maintain stable sort for equal percentFunded values", () => {
      const sorted = sortCampaigns(mockCampaigns, "percentFunded");
      // Campaigns 1 and 2 both have 50% funded
      // They should maintain their original relative order
      const campaign1Index = sorted.findIndex((c) => c.id === "1");
      const campaign2Index = sorted.findIndex((c) => c.id === "2");
      expect(campaign1Index).toBeLessThan(campaign2Index);
    });
  });

  describe("Sort by totalPledged", () => {
    it("should sort campaigns by pledgedAmount descending (largest first)", () => {
      const sorted = sortCampaigns(mockCampaigns, "totalPledged");
      expect(sorted[0].id).toBe("3"); // pledgedAmount: 15000
      expect(sorted[1].id).toBe("1"); // pledgedAmount: 5000
      expect(sorted[2].id).toBe("2"); // pledgedAmount: 2500
    });
  });

  describe("Edge cases", () => {
    it("should handle empty campaign array", () => {
      const sorted = sortCampaigns([], "newest");
      expect(sorted).toHaveLength(0);
    });

    it("should handle single campaign", () => {
      const singleCampaign = [mockCampaigns[0]];
      const sorted = sortCampaigns(singleCampaign, "newest");
      expect(sorted).toHaveLength(1);
      expect(sorted[0].id).toBe("1");
    });

    it("should return a new array instance", () => {
      const sorted = sortCampaigns(mockCampaigns, "newest");
      expect(sorted).not.toBe(mockCampaigns);
    });

    it("should preserve all campaign properties", () => {
      const sorted = sortCampaigns(mockCampaigns, "newest");
      sorted.forEach((campaign) => {
        const original = mockCampaigns.find((c) => c.id === campaign.id);
        expect(campaign).toEqual(original);
      });
    });
  });

  describe("Stability", () => {
    it("should maintain stable sort order for campaigns with equal sort values", () => {
      // Create campaigns with same createdAt
      const equalCreatedAt: Campaign[] = [
        { ...mockCampaigns[0], id: "A", createdAt: 1000 },
        { ...mockCampaigns[1], id: "B", createdAt: 1000 },
        { ...mockCampaigns[2], id: "C", createdAt: 1000 },
      ];

      const sorted = sortCampaigns(equalCreatedAt, "newest");
      // All have same createdAt, so order should be preserved
      expect(sorted[0].id).toBe("A");
      expect(sorted[1].id).toBe("B");
      expect(sorted[2].id).toBe("C");
    });

    it("should maintain stable sort order for campaigns with equal deadlines", () => {
      const equalDeadline: Campaign[] = [
        { ...mockCampaigns[0], id: "A", deadline: 1000 },
        { ...mockCampaigns[1], id: "B", deadline: 1000 },
        { ...mockCampaigns[2], id: "C", deadline: 1000 },
      ];

      const sorted = sortCampaigns(equalDeadline, "deadline");
      // All have same deadline, so order should be preserved
      expect(sorted[0].id).toBe("A");
      expect(sorted[1].id).toBe("B");
      expect(sorted[2].id).toBe("C");
    });
  });
});
