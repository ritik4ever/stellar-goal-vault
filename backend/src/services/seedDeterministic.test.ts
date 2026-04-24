import fs from "fs";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = path.join("/tmp", `stellar-goal-vault-seed-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;

type DbModule = typeof import("./db");
type SeedModule = typeof import("./seedDeterministic");

let getDb: DbModule["getDb"];
let seedDeterministicState: SeedModule["seedDeterministicState"];

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ getDb } = await import("./db"));
  ({ seedDeterministicState } = await import("./seedDeterministic"));
});

beforeEach(() => {
  seedDeterministicState();
});

describe("deterministic seed state", () => {
  it("produces stable campaign and pledge rows across repeated runs", () => {
    const db = getDb();
    const firstCampaigns = db
      .prepare(
        `SELECT id, creator, target_amount, pledged_amount, deadline, created_at, claimed_at
         FROM campaigns ORDER BY id ASC`,
      )
      .all();
    const firstPledges = db
      .prepare(`SELECT campaign_id, contributor, amount, created_at FROM pledges ORDER BY id ASC`)
      .all();

    seedDeterministicState();
    const secondCampaigns = db
      .prepare(
        `SELECT id, creator, target_amount, pledged_amount, deadline, created_at, claimed_at
         FROM campaigns ORDER BY id ASC`,
      )
      .all();
    const secondPledges = db
      .prepare(`SELECT campaign_id, contributor, amount, created_at FROM pledges ORDER BY id ASC`)
      .all();

    expect(secondCampaigns).toEqual(firstCampaigns);
    expect(secondPledges).toEqual(firstPledges);
  });
});
