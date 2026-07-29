import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import express from "express";
import { initDb, resetDbForTests, getDb } from "../services/db";
import { initCampaignStore, createCampaign, addPledge } from "../services/campaignStore";
import * as openIssuesService from "../services/openIssues";

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-routes-test-${process.pid}-${Date.now()}.db`
);

const CREATOR = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const CONTRIBUTOR = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

// Import app after env is configured
process.env.DB_PATH = TEST_DB_PATH;
process.env.NODE_ENV = "test";
import { app } from "../index";

describe("API Route Handlers and Middleware Extra Coverage", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
    initDb();
    initCampaignStore();
  });

  afterEach(() => {
    resetDbForTests();
    try {
      fs.rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore EPERM locks on Windows
    }
  });

  describe("GET /api/open-issues", () => {
    it("should return list of open issues fetched from GitHub service", async () => {
      const mockIssues = [
        { id: 1, title: "Issue 1", url: "http://example.com/1" },
      ];
      const fetchSpy = vi.spyOn(openIssuesService, "fetchOpenIssues").mockResolvedValue(mockIssues);

      const response = await request(app).get("/api/open-issues");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(mockIssues);
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("GET /api/config", () => {
    it("should return the application configuration", async () => {
      const response = await request(app).get("/api/config");

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty("allowedAssets");
      expect(response.body.data).toHaveProperty("soroban");
      expect(response.body.data.allowedAssets).toContain("USDC");
    });
  });

  describe("GET /api/stats", () => {
    it("should return global stats based on active campaigns and pledges", async () => {
      // Create some campaign records
      const c1 = createCampaign({
        creator: CREATOR,
        title: "Stats Campaign 1",
        description: "Verify global statistic calculations with pledges.",
        acceptedTokens: ["USDC"],
        targetAmount: 500,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

      addPledge(c1.id, { contributor: CONTRIBUTOR, amount: 200, assetCode: "USDC" });

      const response = await request(app).get("/api/stats");

      expect(response.status).toBe(200);
      expect(response.body.data.totalCampaigns).toBe(1);
      expect(response.body.data.totalPledgeVolume).toBe(200);
      expect(response.body.data.uniqueContributors).toBe(1);
    });
  });

  describe("GET /api/leaderboard", () => {
    it("should return leaderboard sorted by pledged amount and honor limits", async () => {
      const c = createCampaign({
        creator: CREATOR,
        title: "Leaderboard Campaign",
        description: "Verify leaderboard pagination and ranking logic.",
        acceptedTokens: ["USDC"],
        targetAmount: 1000,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

      addPledge(c.id, { contributor: CONTRIBUTOR, amount: 150, assetCode: "USDC" });

      const response = await request(app).get("/api/leaderboard?limit=5");

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].contributor).toBe(CONTRIBUTOR);
      expect(response.body.data[0].totalPledged).toBe(150);
    });
  });

  describe("Express Error Handling Middlewares", () => {
    it("should return 413 for payload too large entity error", async () => {
      // Simulate payload too large by sending a route error
      const testApp = express();
      testApp.use((req, res, next) => {
        const err = new Error("too large") as any;
        err.type = "entity.too.large";
        next(err);
      });
      // Register standard error handler from index
      const errorHandler = app._router.stack.find((layer: any) => layer.name === "<anonymous>" && layer.handle.length === 4);
      if (errorHandler) {
        testApp.use(errorHandler.handle);
      }

      const res = await request(testApp).get("/test");
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    });

    it("should return 403 for CORS violation error", async () => {
      const testApp = express();
      testApp.use((req, res, next) => {
        next(new Error("Not allowed by CORS"));
      });
      const errorHandler = app._router.stack.find((layer: any) => layer.name === "<anonymous>" && layer.handle.length === 4);
      if (errorHandler) {
        testApp.use(errorHandler.handle);
      }

      const res = await request(testApp).get("/test");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
      expect(res.body.error.message).toBe("CORS policy violation");
    });
  });
});
