import { getDb, initDb } from './db';

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

type SeedPledge = {
  campaignId: string;
  contributor: string;
  amount: number;
  assetCode: string;
  createdAt: number;
};

const BASE_CAMPAIGNS: SeedCampaign[] = [
  {
    id: '1',
    creator: `G${'A'.repeat(55)}`,
    title: 'Open deterministic campaign',
    description: 'Deterministic campaign seed for open status checks.',
    assetCode: 'USDC',
    targetAmount: 500,
    pledgedAmount: 100,
    deadline: FIXED_NOW + 86_400,
    createdAt: FIXED_NOW - 300,
    claimedAt: null,
  },
  {
    id: '2',
    creator: `G${'B'.repeat(55)}`,
    title: 'Funded deterministic campaign',
    description: 'Deterministic campaign seed for funded status checks.',
    assetCode: 'XLM',
    targetAmount: 250,
    pledgedAmount: 250,
    deadline: FIXED_NOW + 43_200,
    createdAt: FIXED_NOW - 200,
    claimedAt: null,
  },
  {
    id: '3',
    creator: `G${'C'.repeat(55)}`,
    title: 'Claimed deterministic campaign',
    description: 'Deterministic campaign seed for claimed status checks.',
    assetCode: 'USDC',
    targetAmount: 300,
    pledgedAmount: 300,
    deadline: FIXED_NOW - 600,
    createdAt: FIXED_NOW - 900,
    claimedAt: FIXED_NOW - 100,
  },
];

const BASE_PLEDGES: SeedPledge[] = [
  { campaignId: '1', contributor: `G${'D'.repeat(55)}`, amount: 100, assetCode: 'USDC', createdAt: FIXED_NOW - 250 },
  { campaignId: '2', contributor: `G${'E'.repeat(55)}`, amount: 250, assetCode: 'XLM', createdAt: FIXED_NOW - 150 },
];

// Deterministic status/asset rotation used to extend past the 3 base campaigns.
// Each generated campaign gets one matching pledge, same as the base set.
const EXTRA_STATUS_CYCLE: Array<'open' | 'funded' | 'claimed'> = ['open', 'funded', 'claimed'];
const EXTRA_ASSET_CYCLE = ['USDC', 'XLM'];

function letterFor(index: number): string {
  // A-Z, then AA, BB... style wrap for very large counts (index is 0-based
  // continuing on from the 3 base campaigns, which already used A/B/C).
  const cycleIndex = index % 26;
  const letter = String.fromCharCode(65 + cycleIndex);
  return letter;
}

function buildExtraCampaign(index: number): { campaign: SeedCampaign; pledge: SeedPledge } {
  // index is 0-based for campaigns beyond the 3 base ones, so real id = index + 4
  const id = String(index + 4);
  const letter = letterFor(index + 3); // continue the A/B/C sequence
  const creator = `G${letter.repeat(55)}`;
  const status = EXTRA_STATUS_CYCLE[index % EXTRA_STATUS_CYCLE.length];
  const assetCode = EXTRA_ASSET_CYCLE[index % EXTRA_ASSET_CYCLE.length];

  const targetAmount = 200 + index * 50;
  let pledgedAmount: number;
  let deadline: number;
  let claimedAt: number | null;

  if (status === 'open') {
    pledgedAmount = Math.floor(targetAmount * 0.4);
    deadline = FIXED_NOW + 86_400 + index * 1_000;
    claimedAt = null;
  } else if (status === 'funded') {
    pledgedAmount = targetAmount;
    deadline = FIXED_NOW + 43_200 + index * 1_000;
    claimedAt = null;
  } else {
    pledgedAmount = targetAmount;
    deadline = FIXED_NOW - 600 - index * 1_000;
    claimedAt = FIXED_NOW - 100 - index * 1_000;
  }

  const campaign: SeedCampaign = {
    id,
    creator,
    title: `Deterministic campaign ${id} (${status})`,
    description: `Generated deterministic campaign seed #${id} for ${status} status checks.`,
    assetCode,
    targetAmount,
    pledgedAmount,
    deadline,
    createdAt: FIXED_NOW - 300 - index * 100,
    claimedAt,
  };

  const pledgeLetter = letterFor(index + 3 + 100); // distinct pool from campaign creators
  const pledge: SeedPledge = {
    campaignId: id,
    contributor: `G${pledgeLetter.repeat(55)}`,
    amount: pledgedAmount > 0 ? pledgedAmount : 1,
    assetCode,
    createdAt: FIXED_NOW - 250 - index * 100,
  };

  return { campaign, pledge };
}

function buildSeedSet(count: number): { campaigns: SeedCampaign[]; pledges: SeedPledge[] } {
  if (count <= 0) {
    throw new Error('count must be a positive integer');
  }

  if (count <= BASE_CAMPAIGNS.length) {
    const campaigns = BASE_CAMPAIGNS.slice(0, count);
    const ids = new Set(campaigns.map((c) => c.id));
    const pledges = BASE_PLEDGES.filter((p) => ids.has(p.campaignId));
    return { campaigns, pledges };
  }

  const extraCount = count - BASE_CAMPAIGNS.length;
  const extras = Array.from({ length: extraCount }, (_, i) => buildExtraCampaign(i));

  return {
    campaigns: [...BASE_CAMPAIGNS, ...extras.map((e) => e.campaign)],
    pledges: [...BASE_PLEDGES, ...extras.map((e) => e.pledge)],
  };
}

/**
 * Wipes and repopulates the dev database with `count` deterministic campaigns
 * (default 3). Returns the seeded campaign IDs in insertion order.
 */
export function seedDeterministicState(count: number = BASE_CAMPAIGNS.length): string[] {
  initDb();
  const db = getDb();

  const { campaigns, pledges } = buildSeedSet(count);

  db.prepare(`DELETE FROM campaign_events`).run();
  db.prepare(`DELETE FROM pledges`).run();
  db.prepare(`DELETE FROM campaigns`).run();

  const insertCampaign = db.prepare(
    `INSERT INTO campaigns (
      id, creator, title, description, accepted_tokens_json, target_amount, pledged_amount, deadline, created_at, claimed_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );

  for (const campaign of campaigns) {
    insertCampaign.run(
      campaign.id,
      campaign.creator,
      campaign.title,
      campaign.description,
      JSON.stringify([campaign.assetCode]),
      campaign.targetAmount,
      campaign.pledgedAmount,
      campaign.deadline,
      campaign.createdAt,
      campaign.claimedAt,
    );
  }

  const insertPledge = db.prepare(
    `INSERT INTO pledges (campaign_id, contributor, amount, asset_code, created_at, refunded_at, transaction_hash)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  );

  for (const pledge of pledges) {
    insertPledge.run(pledge.campaignId, pledge.contributor, pledge.amount, pledge.assetCode, pledge.createdAt);
  }

  return campaigns.map((c) => c.id);
}

export function parseCountArg(argv: string[]): number {
  const flagIndex = argv.findIndex((arg) => arg === '--count' || arg.startsWith('--count='));
  if (flagIndex === -1) {
    return BASE_CAMPAIGNS.length;
  }

  const raw = argv[flagIndex].includes('=')
    ? argv[flagIndex].split('=')[1]
    : argv[flagIndex + 1];

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --count value: "${raw}". Must be a positive integer.`);
  }

  return parsed;
}