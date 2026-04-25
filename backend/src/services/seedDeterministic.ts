import { getDb, initDb } from "./db";

const FIXED_NOW = 1_750_000_000;

type SeedCampaign = {
  id: string;
  creator: string;
  title: string;
  description: string;
  assetCode: string;
  targetAmount: number;
  pledgedAmount: number;
  deadline: number;
  createdAt: number;
  claimedAt: number | null;
};

const SEED_CAMPAIGNS: SeedCampaign[] = [
  {
    id: "1",
    creator: `G${"A".repeat(55)}`,
    title: "Open deterministic campaign",
    description: "Deterministic campaign seed for open status checks.",
    assetCode: "USDC",
    targetAmount: 500,
    pledgedAmount: 100,
    deadline: FIXED_NOW + 86_400,
    createdAt: FIXED_NOW - 300,
    claimedAt: null,
  },
  {
    id: "2",
    creator: `G${"B".repeat(55)}`,
    title: "Funded deterministic campaign",
    description: "Deterministic campaign seed for funded status checks.",
    assetCode: "XLM",
    targetAmount: 250,
    pledgedAmount: 250,
    deadline: FIXED_NOW + 43_200,
    createdAt: FIXED_NOW - 200,
    claimedAt: null,
  },
  {
    id: "3",
    creator: `G${"C".repeat(55)}`,
    title: "Claimed deterministic campaign",
    description: "Deterministic campaign seed for claimed status checks.",
    assetCode: "USDC",
    targetAmount: 300,
    pledgedAmount: 300,
    deadline: FIXED_NOW - 600,
    createdAt: FIXED_NOW - 900,
    claimedAt: FIXED_NOW - 100,
  },
];

export function seedDeterministicState(): void {
  initDb();
  const db = getDb();

  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();

  const insertCampaign = db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, asset_code, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  for (const campaign of SEED_CAMPAIGNS) {
    insertCampaign.run(
      campaign.id,
      campaign.creator,
      campaign.title,
      campaign.description,
      campaign.assetCode,
      campaign.targetAmount,
      campaign.pledgedAmount,
      campaign.deadline,
      campaign.createdAt,
      campaign.claimedAt,
    );
  }

  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, created_at, refunded_at, transaction_hash)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run("1", `G${"D".repeat(55)}`, 100, FIXED_NOW - 250);

  db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, created_at, refunded_at, transaction_hash)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run("2", `G${"E".repeat(55)}`, 250, FIXED_NOW - 150);
}

if (require.main === module) {
  seedDeterministicState();
  // Keep output terse for CI/script usage.
  console.log("Deterministic database seed complete.");
}
