import fs from 'fs';
import { ensureSeedWorkflowIndexes, getDb, initDb } from './db';

const FIXED_NOW = 1_750_000_000;

export class SeedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

export const MAX_SEED_COUNT = 10_000;

export interface SeedConfigValidationOptions {
  count: number;
  env?: Record<string, string | undefined>;
  dbPath?: string;
}

/**
 * Validates network, file, and environment inputs relevant to seed configuration
 * before any database operations or destructive writes occur.
 */
export function validateSeedConfig(options: SeedConfigValidationOptions): void {
  const env = options.env ?? process.env;

  // 1. Network & Environment protection:
  // Development seed data performs destructive database writes and inserts mock fixtures.
  // It must never run in production or on a live network (mainnet).
  if (env.NODE_ENV === 'production') {
    throw new SeedConfigError(
      'Development seed data is blocked in production environment (NODE_ENV=production) to prevent destructive data loss.',
    );
  }

  const network = (env.NETWORK || '').trim().toLowerCase();
  if (network === 'mainnet' || network === 'public') {
    throw new SeedConfigError(
      'Development seed data is blocked on mainnet network to prevent mock fixture contamination.',
    );
  }

  const passphrase = (env.SOROBAN_NETWORK_PASSPHRASE || env.NETWORK_PASSPHRASE || '').trim();
  if (passphrase === 'Public Global Stellar Network ; September 2015') {
    throw new SeedConfigError(
      'Development seed data is blocked when mainnet network passphrase is configured.',
    );
  }

  const rpcUrl = (env.SOROBAN_RPC_URL || env.RPC_URL || '').trim().toLowerCase();
  if (rpcUrl.includes('mainnet') || rpcUrl.includes('publicnode')) {
    throw new SeedConfigError(
      'Development seed data is blocked when mainnet RPC endpoint is configured.',
    );
  }

  // 2. Count validation:
  const count = options.count;
  if (!Number.isInteger(count) || count <= 0) {
    throw new SeedConfigError(`Invalid seed count: ${count}. Must be a positive integer.`);
  }

  if (count > MAX_SEED_COUNT) {
    throw new SeedConfigError(
      `Seed count ${count} exceeds maximum allowed limit (${MAX_SEED_COUNT}) to prevent resource exhaustion.`,
    );
  }

  // 3. File / Database path validation:
  const dbPath = (options.dbPath || env.DB_PATH || 'backend/data/campaigns.db').trim();
  if (!dbPath) {
    throw new SeedConfigError('Database path cannot be empty.');
  }

  if (fs.existsSync(dbPath)) {
    try {
      const stat = fs.statSync(dbPath);
      if (stat.isDirectory()) {
        throw new SeedConfigError(
          `Database path "${dbPath}" is a directory, expected a database file path.`,
        );
      }
    } catch (err) {
      if (err instanceof SeedConfigError) throw err;
    }
  }
}

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
  {
    campaignId: '1',
    contributor: `G${'D'.repeat(55)}`,
    amount: 100,
    assetCode: 'USDC',
    createdAt: FIXED_NOW - 250,
  },
  {
    campaignId: '2',
    contributor: `G${'E'.repeat(55)}`,
    amount: 250,
    assetCode: 'XLM',
    createdAt: FIXED_NOW - 150,
  },
  {
    campaignId: '3',
    contributor: `G${'F'.repeat(55)}`,
    amount: 300,
    assetCode: 'USDC',
    createdAt: FIXED_NOW - 850,
  },
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
    throw new SeedConfigError('count must be a positive integer');
  }

  if (count <= BASE_CAMPAIGNS.length) {
    const campaigns = BASE_CAMPAIGNS.slice(0, count);
    const ids = new Set(campaigns.map((c) => c.id));
    const pledges = BASE_PLEDGES.filter((p) => ids.has(p.campaignId));
    return { campaigns, pledges };
  }

  const extraCount = count - BASE_CAMPAIGNS.length;
  const extras = Array.from({ length: extraCount }, (_, i) => buildExtraCampaign(i));

  const allCampaigns = [...BASE_CAMPAIGNS, ...extras.map((e) => e.campaign)];
  const allPledges = [...BASE_PLEDGES, ...extras.map((e) => e.pledge)];

  for (const c of allCampaigns) {
    if (!c.id || !c.creator || !c.title || c.targetAmount <= 0) {
      throw new SeedConfigError(`Generated campaign fixture ${c.id} has invalid fields.`);
    }
  }

  return {
    campaigns: allCampaigns,
    pledges: allPledges,
  };
}

const SEED_VERSION = 'deterministic-v1';
const SEED_MARKER_KEY = 'deterministic_seed';

export interface SeedDeterministicResult extends Array<string> {
  status: 'seeded' | 'already-seeded';
  campaignIds: string[];
  ids: string[];
  count: number;
  message: string;
}

export interface SeedDeterministicOptions {
  force?: boolean;
  env?: Record<string, string | undefined>;
  dbPath?: string;
}

function makeResult(
  status: 'seeded' | 'already-seeded',
  campaignIds: string[],
  count: number,
  message: string,
): SeedDeterministicResult {
  const result = [...campaignIds] as SeedDeterministicResult;
  Object.defineProperties(result, {
    status: { value: status, enumerable: false, writable: true },
    campaignIds: { value: campaignIds, enumerable: false, writable: true },
    ids: { value: campaignIds, enumerable: false, writable: true },
    count: { value: count, enumerable: false, writable: true },
    message: { value: message, enumerable: false, writable: true },
  });
  return result;
}

/**
 * Wipes and repopulates the dev database with `count` deterministic campaigns
 * (default 3). Returns a result describing whether the database was freshly
 * seeded or already contained a matching deterministic seed.
 *
 * Rerun safety: a marker row in `seed_metadata` and `seed_markers` records the
 * seed version and the last seeded count. If the marker matches the requested count
 * and the deterministic rows are still present, the wipe is skipped.
 * Pass options.force to bypass the idempotency guard and force wipe-and-reinsert.
 */
export function seedDeterministicState(
  count: number = BASE_CAMPAIGNS.length,
  options: SeedDeterministicOptions = {},
): SeedDeterministicResult {
  // Validate network, file, and environment inputs BEFORE any destructive database action
  validateSeedConfig({
    count,
    env: options.env ?? process.env,
    dbPath: options.dbPath ?? process.env.DB_PATH,
  });

  initDb();
  const db = getDb();
  // Ensure seed-path indexes exist before wipe/reseed so FK checks and
  // post-seed accounting queries use the intended plans.
  ensureSeedWorkflowIndexes(db);

  const { campaigns, pledges } = buildSeedSet(count);
  const expectedIds = campaigns.map((c) => c.id);

  // Use explicit transaction to ensure atomicity: either all data is seeded
  // or no partial state is persisted, allowing safe retries.
  return db.transaction((): SeedDeterministicResult => {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS seed_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ).run();

    db.prepare(
      `CREATE TABLE IF NOT EXISTS seed_markers (
        id INTEGER PRIMARY KEY,
        version TEXT NOT NULL,
        count INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ).run();

    const force = Boolean(options.force);

    if (!force) {
      const marker = db
        .prepare(`SELECT value FROM seed_metadata WHERE key = ?`)
        .get(SEED_MARKER_KEY) as { value: string } | undefined;

      if (marker) {
        let parsed: { version?: string; count?: number } | null = null;
        try {
          parsed = JSON.parse(marker.value);
        } catch {
          parsed = null;
        }

        if (
          parsed &&
          parsed.version === SEED_VERSION &&
          parsed.count === count &&
          hasMatchingDeterministicRows(db, expectedIds)
        ) {
          return makeResult(
            'already-seeded',
            expectedIds,
            count,
            `Deterministic seed already applied (count=${count}). ` +
              `Skipping wipe. To force a reseed, run with a different --count ` +
              `or pass --force.`,
          );
        }
      }
    }

    // Child tables first so FK enforcement cannot leave a partial wipe.
    // notifications / campaign_comments are not always empty in long-lived
    // dev DBs; skipping them is a failure mode happy-path API tests miss.
    db.prepare(`DELETE FROM notifications`).run();
    db.prepare(`DELETE FROM campaign_comments`).run();
    db.prepare(`DELETE FROM campaign_events`).run();
    db.prepare(`DELETE FROM pledges`).run();
    db.prepare(`DELETE FROM campaigns`).run();
    // FTS delete trigger is not guaranteed on every migrated DB — clear explicitly.
    db.prepare(`DELETE FROM campaigns_fts`).run();

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
      insertPledge.run(
        pledge.campaignId,
        pledge.contributor,
        pledge.amount,
        pledge.assetCode,
        pledge.createdAt,
      );
    }

    db.prepare(
      `INSERT INTO seed_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(SEED_MARKER_KEY, JSON.stringify({ version: SEED_VERSION, count }));

    db.prepare(`DELETE FROM seed_markers`).run();
    db.prepare(`INSERT INTO seed_markers (version, count, created_at) VALUES (?, ?, ?)`).run(
      SEED_VERSION,
      count,
      Date.now(),
    );

    return makeResult('seeded', expectedIds, count, `Deterministic seed applied (count=${count}).`);
  })();
}

function hasMatchingDeterministicRows(
  db: ReturnType<typeof getDb>,
  expectedIds: string[],
): boolean {
  if (expectedIds.length === 0) {
    return true;
  }
  const placeholders = expectedIds.map(() => '?').join(', ');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE id IN (${placeholders})`)
    .get(...expectedIds) as { n: number } | undefined;
  return (row?.n ?? 0) === expectedIds.length;
}

export function parseCountArg(
  argv: string[] = [],
  env: Record<string, string | undefined> = process.env,
): number {
  const flagIndex = argv.findIndex((arg) => arg === '--count' || arg.startsWith('--count='));
  let raw: string | undefined;

  if (flagIndex !== -1) {
    raw = argv[flagIndex].includes('=') ? argv[flagIndex].split('=')[1] : argv[flagIndex + 1];
  } else if (env.SEED_COUNT) {
    raw = env.SEED_COUNT;
  } else if (env.CAMPAIGN_SEED_COUNT) {
    raw = env.CAMPAIGN_SEED_COUNT;
  }

  if (raw === undefined || raw === null || raw.trim() === '') {
    return BASE_CAMPAIGNS.length;
  }

  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SeedConfigError(`Invalid --count value: "${raw}". Must be a positive integer.`);
  }

  if (parsed > MAX_SEED_COUNT) {
    throw new SeedConfigError(
      `Invalid --count value: ${parsed}. Exceeds maximum limit of ${MAX_SEED_COUNT}.`,
    );
  }

  return parsed;
}
