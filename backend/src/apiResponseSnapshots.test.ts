import fs from "fs";
import { Server } from "http";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "./index";
import { initCampaignStore } from "./services/campaignStore";
import { getDb, resetDbForTests } from "./services/db";

const TEST_DB_PATH = path.join(
  "/tmp",
  `stellar-goal-vault-api-snapshots-${process.pid}.db`,
);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR = `G${"B".repeat(55)}`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  resetDbForTests();
  initCampaignStore();

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address() as { port: number };
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  resetDbForTests();
  fs.rmSync(TEST_DB_PATH, { force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
  db.prepare(
    `DELETE FROM sqlite_sequence WHERE name IN ('campaign_events', 'pledges')`,
  ).run();
});

async function get(apiPath: string) {
  const response = await fetch(`${baseUrl}${apiPath}`);
  const data = await response.json();

  return {
    status: response.status,
    data,
  };
}

async function post(apiPath: string, body: unknown) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();

  return {
    status: response.status,
    data,
  };
}

function normalizeCampaignRecord(campaign: Record<string, any>) {
  return {
    ...campaign,
    deadline: "<deadline>",
    createdAt: "<timestamp>",
    pledges: Array.isArray(campaign.pledges)
      ? campaign.pledges.map((pledge: Record<string, any>) => ({
          ...pledge,
          createdAt: "<timestamp>",
        }))
      : campaign.pledges,
    history: Array.isArray(campaign.history)
      ? campaign.history.map((event: Record<string, any>) => ({
          ...event,
          timestamp: "<timestamp>",
          metadata: normalizeEventMetadata(event.metadata),
        }))
      : campaign.history,
  };
}

function normalizeEventMetadata(metadata: Record<string, any> | undefined) {
  if (!metadata) {
    return metadata;
  }

  return {
    ...metadata,
    ...(typeof metadata.deadline === "number" ? { deadline: "<deadline>" } : {}),
  };
}

function normalizeCampaignListResponse(response: { status: number; data: any }) {
  return {
    status: response.status,
    data: {
      ...response.data,
      data: response.data.data.map((campaign: Record<string, any>) =>
        normalizeCampaignRecord(campaign),
      ),
    },
  };
}

function normalizeCampaignDetailResponse(response: { status: number; data: any }) {
  return {
    status: response.status,
    data: {
      ...response.data,
      data: normalizeCampaignRecord(response.data.data),
    },
  };
}

function normalizeCampaignHistoryResponse(response: { status: number; data: any }) {
  return {
    status: response.status,
    data: {
      ...response.data,
      data: response.data.data.map((event: Record<string, any>) => ({
        ...event,
        timestamp: "<timestamp>",
        metadata: normalizeEventMetadata(event.metadata),
      })),
    },
  };
}

async function seedCampaignFixture() {
  const createRes = await post("/api/campaigns", {
    creator: CREATOR,
    title: "Snapshot-backed community vault",
    description:
      "A stable fixture used to capture API response shapes for campaign endpoints.",
    acceptedTokens: ["USDC", "XLM"],
    targetAmount: 250,
    deadline: Math.floor(Date.now() / 1000) + 86_400,
    metadata: {
      imageUrl: "https://example.com/vault.png",
      externalLink: "https://example.com/vault",
    },
    maxPerContributor: 150,
  });

  expect(createRes.status).toBe(201);
  const campaignId = createRes.data.data.id as string;

  const pledgeRes = await post(`/api/campaigns/${campaignId}/pledges`, {
    contributor: CONTRIBUTOR,
    amount: 75,
    assetCode: "USDC",
  });

  expect(pledgeRes.status).toBe(201);

  const db = getDb();
  db.prepare(`UPDATE campaigns SET created_at = ? WHERE id = ?`).run(1_700_000_000, campaignId);
  db.prepare(`UPDATE pledges SET created_at = ? WHERE campaign_id = ?`).run(
    1_700_000_100,
    campaignId,
  );
  db.prepare(`UPDATE campaign_events SET timestamp = ? WHERE campaign_id = ? AND event_type = 'created'`).run(
    1_700_000_000,
    campaignId,
  );
  db.prepare(`UPDATE campaign_events SET timestamp = ? WHERE campaign_id = ? AND event_type = 'pledged'`).run(
    1_700_000_100,
    campaignId,
  );

  return campaignId;
}

describe("API response snapshots", () => {
  it("matches the campaigns list response shape", async () => {
    await seedCampaignFixture();

    const response = await get("/api/campaigns?page=1&limit=10");

    expect(normalizeCampaignListResponse(response)).toMatchSnapshot();
  });

  it("matches the campaign detail response shape", async () => {
    const campaignId = await seedCampaignFixture();

    const response = await get(`/api/campaigns/${campaignId}`);

    expect(normalizeCampaignDetailResponse(response)).toMatchSnapshot();
  });

  it("matches the campaign history response shape", async () => {
    const campaignId = await seedCampaignFixture();

    const response = await get(`/api/campaigns/${campaignId}/history`);

    expect(normalizeCampaignHistoryResponse(response)).toMatchSnapshot();
  });
});
