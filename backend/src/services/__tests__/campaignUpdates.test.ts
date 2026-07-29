import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join("/tmp", `stellar-goal-vault-updates-${process.pid}.db`);

process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = "";

type CampaignStoreModule = typeof import("../campaignStore");
type DbModule = typeof import("../db");
type EventHistoryModule = typeof import("../eventHistory");
type NotificationModule = typeof import("../notificationService");

let createCampaign: CampaignStoreModule["createCampaign"];
let addPledge: CampaignStoreModule["addPledge"];
let createCampaignUpdate: CampaignStoreModule["createCampaignUpdate"];
let getCampaignUpdates: CampaignStoreModule["getCampaignUpdates"];
let initCampaignStore: CampaignStoreModule["initCampaignStore"];
let getDb: DbModule["getDb"];
let getCampaignHistory: EventHistoryModule["getCampaignHistory"];
let registerNotificationHandler: NotificationModule["registerNotificationHandler"];
let clearNotificationHandlers: NotificationModule["clearNotificationHandlers"];

const CREATOR = `G${"A".repeat(55)}`;
const CONTRIBUTOR_1 = `G${"B".repeat(55)}`;
const CONTRIBUTOR_2 = `G${"C".repeat(55)}`;
const NON_CREATOR = `G${"D".repeat(55)}`;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });

  ({
    createCampaign,
    addPledge,
    createCampaignUpdate,
    getCampaignUpdates,
    initCampaignStore,
  } = await import("../campaignStore"));
  ({ getDb } = await import("../db"));
  ({ getCampaignHistory } = await import("../eventHistory"));
  ({ registerNotificationHandler, clearNotificationHandlers } = await import(
    "../notificationService"
  ));
  initCampaignStore();
});

beforeEach(() => {
  clearNotificationHandlers();
  const db = getDb();
  db.prepare(`DELETE FROM campaign_updates`).run();
  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();
});

describe("Campaign Updates Feature", () => {
  it("allows creator to post a campaign update and returns the stored update", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Update Test Campaign",
      description: "Testing campaign update creation by creator.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    const update = createCampaignUpdate(campaign.id, {
      creatorAddress: CREATOR,
      content: "We have reached our first milestone!",
    });

    expect(update.id).toBeGreaterThan(0);
    expect(update.campaignId).toBe(campaign.id);
    expect(update.creatorAddress).toBe(CREATOR);
    expect(update.creator_address).toBe(CREATOR);
    expect(update.content).toBe("We have reached our first milestone!");
    expect(update.createdAt).toBeGreaterThan(0);
  });

  it("prevents non-creators from posting campaign updates", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Update Permission Test",
      description: "Testing that non-creators cannot post updates.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    expect(() =>
      createCampaignUpdate(campaign.id, {
        creatorAddress: NON_CREATOR,
        content: "Unauthorized update attempt.",
      }),
    ).toThrowError(/Only the campaign creator can post updates/);
  });

  it("throws 404 when posting an update for a non-existent campaign", () => {
    expect(() =>
      createCampaignUpdate("999999", {
        creatorAddress: CREATOR,
        content: "Update for non-existent campaign.",
      }),
    ).toThrowError(/Campaign not found/);
  });

  it("notifies active contributors when a campaign update is posted", async () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Notification Test Campaign",
      description: "Testing contributor notifications on campaign update.",
      assetCode: "USDC",
      targetAmount: 1000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    addPledge(campaign.id, { contributor: CONTRIBUTOR_1, amount: 100 });
    addPledge(campaign.id, { contributor: CONTRIBUTOR_2, amount: 200 });

    const notificationsReceived: Array<{ campaignId: string; recipients: string[] }> = [];

    registerNotificationHandler((payload) => {
      notificationsReceived.push(payload);
    });

    createCampaignUpdate(campaign.id, {
      creatorAddress: CREATOR,
      content: "Major milestone achieved! Thank you backers.",
    });

    expect(notificationsReceived).toHaveLength(1);
    expect(notificationsReceived[0].campaignId).toBe(campaign.id);
    expect(notificationsReceived[0].recipients.sort()).toEqual(
      [CONTRIBUTOR_1, CONTRIBUTOR_2].sort(),
    );
  });

  it("fetches list of updates for a campaign in reverse chronological order", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "List Updates Test Campaign",
      description: "Testing retrieval of campaign updates list.",
      assetCode: "XLM",
      targetAmount: 2000,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    createCampaignUpdate(campaign.id, {
      creatorAddress: CREATOR,
      content: "First update",
    });

    createCampaignUpdate(campaign.id, {
      creatorAddress: CREATOR,
      content: "Second update",
    });

    const updates = getCampaignUpdates(campaign.id);
    expect(updates).toHaveLength(2);
    expect(updates[0].content).toBe("Second update");
    expect(updates[1].content).toBe("First update");
  });

  it("records an update_posted event in event history", () => {
    const campaign = createCampaign({
      creator: CREATOR,
      title: "Event History Test Campaign",
      description: "Testing event history logging for updates.",
      assetCode: "USDC",
      targetAmount: 500,
      deadline: Math.floor(Date.now() / 1000) + 86400,
    });

    createCampaignUpdate(campaign.id, {
      creatorAddress: CREATOR,
      content: "Check out our progress!",
    });

    const history = getCampaignHistory(campaign.id);
    const updateEvent = history.find((e) => e.eventType === "update_posted");
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.actor).toBe(CREATOR);
  });
});
