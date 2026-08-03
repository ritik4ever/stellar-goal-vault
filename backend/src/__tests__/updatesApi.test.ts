import fs from "fs";
import http from "http";
import path from "path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join("/tmp", `stellar-goal-vault-updates-api-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type IndexModule = typeof import("../index");
type CampaignStoreModule = typeof import("../services/campaignStore");
type DbModule = typeof import("../services/db");

let app: express.Express;
let createCampaign: CampaignStoreModule["createCampaign"];
let initCampaignStore: CampaignStoreModule["initCampaignStore"];
let getDb: DbModule["getDb"];
let server: http.Server;
let baseUrl: string;

const CREATOR = `G${"A".repeat(55)}`;
const NON_CREATOR = `G${"B".repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ app } = await import("../index"));
  ({ createCampaign, initCampaignStore } = await import("../services/campaignStore"));
  ({ getDb } = await import("../services/db"));
  initCampaignStore();

  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_updates`).run();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

async function apiRequest(
  method: "GET" | "POST",
  endpoint: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${endpoint}`, options);
  const data = await response.json();
  return { status: response.status, body: data };
}

describe("Campaign Updates API Endpoints", () => {
  it("POST /api/campaigns/:id/updates returns 201 when posted by creator", async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "API Update Test",
      description: "Testing campaign updates HTTP API endpoint.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/updates`, {
      creator_address: CREATOR,
      content: "Hello backers! Here is an update.",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.creatorAddress).toBe(CREATOR);
    expect(res.body.data.content).toBe("Hello backers! Here is an update.");
  });

  it("POST /api/campaigns/:id/updates returns 403 when posted by non-creator", async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "API Update Auth Test",
      description: "Testing authorization check on updates endpoint.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/updates`, {
      creator_address: NON_CREATOR,
      content: "Fake update from non-creator.",
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("POST /api/campaigns/:id/updates returns 400 when content exceeds 2000 characters", async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "API Update Validation Test",
      description: "Testing 2000 char max length validation.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    const longContent = "a".repeat(2001);

    const res = await apiRequest("POST", `/api/campaigns/${campaign.id}/updates`, {
      creator_address: CREATOR,
      content: longContent,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/campaigns/:id/updates returns 200 with list of updates", async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "API Get Updates Test",
      description: "Testing GET updates endpoint.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    await apiRequest("POST", `/api/campaigns/${campaign.id}/updates`, {
      creator: CREATOR,
      content: "First post",
    });

    await apiRequest("POST", `/api/campaigns/${campaign.id}/updates`, {
      creatorAddress: CREATOR,
      content: "Second post",
    });

    const res = await apiRequest("GET", `/api/campaigns/${campaign.id}/updates`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].content).toBe("Second post");
    expect(res.body.data[1].content).toBe("First post");
  });
});
