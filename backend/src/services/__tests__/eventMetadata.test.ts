import path from "path";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  recordEvent,
  getCampaignHistory,
  getEventByTxHash,
  getEventsByLedger,
  getEventsBySource,
  BlockchainMetadata,
} from "../eventHistory";
import { getDb, initDb, resetDbForTests } from "../db";

// Simple test to verify blockchain metadata functionality
describe("Event Metadata Support", () => {
  beforeAll(() => {
    process.env.DB_PATH = path.join("/tmp", `stellar-goal-vault-event-metadata-${process.pid}.db`);
    resetDbForTests();
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare(`DELETE FROM campaign_events`).run();
    db.prepare(`DELETE FROM pledges`).run();
    db.prepare(`DELETE FROM campaigns`).run();
  });

  function ensureCampaign(campaignId: string): void {
    getDb()
      .prepare(
        `INSERT INTO campaigns (
          id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        campaignId,
        `G${"A".repeat(55)}`,
        `Campaign ${campaignId}`,
        "Synthetic campaign record for event metadata tests.",
        JSON.stringify(["USDC"]),
        100,
        0,
        Math.floor(Date.now() / 1000) + 3600,
        Math.floor(Date.now() / 1000),
        null,
        null,
      );
  }

  test("should record and retrieve events with blockchain metadata", () => {
    const campaignId = "test-campaign-1";
    ensureCampaign(campaignId);
    const blockchainMetadata: BlockchainMetadata = {
      txHash: "abc123def456",
      ledgerNumber: 12345,
      ledgerCloseTime: 1640995200,
      eventIndex: 2,
      contractId: "CTEST123",
      source: "soroban",
    };

    // Record event with blockchain metadata
    recordEvent(
      campaignId,
      "pledged",
      1640995200,
      "GTEST123",
      100.0,
      { testData: "value" },
      blockchainMetadata,
    );

    // Retrieve and verify
    const events = getCampaignHistory(campaignId);
    expect(events).toHaveLength(1);
    expect(events[0].blockchainMetadata).toEqual(blockchainMetadata);
  });

  test("should query events by transaction hash", () => {
    const txHash = "unique-tx-hash-123";
    ensureCampaign("test-campaign-2");
    const blockchainMetadata: BlockchainMetadata = {
      txHash,
      source: "soroban",
    };

    recordEvent("test-campaign-2", "created", Date.now(), "GTEST456", undefined, {}, blockchainMetadata);

    const event = getEventByTxHash(txHash);
    expect(event).toBeDefined();
    expect(event?.blockchainMetadata?.txHash).toBe(txHash);
  });

  test("should query events by ledger number", () => {
    const ledgerNumber = 54321;
    ensureCampaign("test-campaign-3");
    const blockchainMetadata: BlockchainMetadata = {
      ledgerNumber,
      eventIndex: 1,
      source: "soroban",
    };

    recordEvent("test-campaign-3", "claimed", Date.now(), "GTEST789", 200.0, {}, blockchainMetadata);

    const events = getEventsByLedger(ledgerNumber);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].blockchainMetadata?.ledgerNumber).toBe(ledgerNumber);
  });

  test("should query events by source", () => {
    // Record local event
    ensureCampaign("test-campaign-4");
    recordEvent("test-campaign-4", "created", Date.now(), "GLOCAL123", undefined, {}, { source: "local" });

    // Record soroban event
    ensureCampaign("test-campaign-5");
    recordEvent("test-campaign-5", "pledged", Date.now(), "GSOROBAN123", 50.0, {}, { source: "soroban" });

    const localEvents = getEventsBySource("local");
    const sorobanEvents = getEventsBySource("soroban");

    expect(localEvents.length).toBeGreaterThan(0);
    expect(sorobanEvents.length).toBeGreaterThan(0);
    expect(localEvents.every((event) => event.blockchainMetadata?.source === "local")).toBe(true);
    expect(sorobanEvents.every((event) => event.blockchainMetadata?.source === "soroban")).toBe(true);
  });

  test("should handle events without blockchain metadata (backward compatibility)", () => {
    // Record event without blockchain metadata (old format)
    ensureCampaign("test-campaign-6");
    recordEvent("test-campaign-6", "refunded", Date.now(), "GOLD123", 75.0, { reason: "test" });

    const events = getCampaignHistory("test-campaign-6");
    expect(events).toHaveLength(1);
    expect(events[0].blockchainMetadata).toBeUndefined();
    expect(events[0].metadata).toEqual({ reason: "test" });
  });
});
