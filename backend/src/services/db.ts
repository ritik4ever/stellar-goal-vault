import Database from 'better-sqlite3';
import path from 'path';

type SQLiteDatabase = ReturnType<typeof Database>;

let db: SQLiteDatabase | null = null;

function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'campaigns.db');
}

export type DbHealthStatus = 'up' | 'down';

export function getDb(): SQLiteDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }

  return db;
}

export function initDb(): void {
  if (db) {
    return;
  }

  const fs = require('fs') as typeof import('fs');
  const dbPath = resolveDbPath();
  const dir = path.dirname(dbPath);

  if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable Write-Ahead Logging (WAL) mode.
  // This is the chosen journal mode to prevent unnecessary lock contention,
  // allowing reads and writes to occur concurrently without blocking each other.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
}

export function resetDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function checkDbHealth(): {
  status: DbHealthStatus;
  reachable: boolean;
} {
  try {
    const database = getDb();
    database.prepare('SELECT 1 AS ok').get();

    return {
      status: 'up',
      reachable: true,
    };
  } catch {
    return {
      status: 'down',
      reachable: false,
    };
  }
}

function migrate(database: SQLiteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id                    TEXT PRIMARY KEY,
      creator               TEXT NOT NULL,
      title                 TEXT NOT NULL,
      description           TEXT NOT NULL,
      accepted_tokens_json  TEXT NOT NULL,
      target_amount         REAL NOT NULL,
      pledged_amount        REAL NOT NULL DEFAULT 0,
      deadline              INTEGER NOT NULL,
      created_at            INTEGER NOT NULL,
      claimed_at            INTEGER,
      failed_at             INTEGER,
      metadata_json         TEXT,
      max_per_contributor   INTEGER
    );

    -- 🌟 1. Create our new cheat-sheet search index table
    CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts USING fts5(
      id UNINDEXED,
      title,
      description
    );

    -- 🔄 2. Automatically copy new campaigns into the cheat-sheet
    CREATE TRIGGER IF NOT EXISTS after_campaigns_insert AFTER INSERT ON campaigns BEGIN
      INSERT INTO campaigns_fts(id, title, description) 
      VALUES (new.id, new.title, new.description);
    END;

    -- 🔄 3. Automatically update the cheat-sheet if a campaign changes
    CREATE TRIGGER IF NOT EXISTS after_campaigns_update AFTER UPDATE ON campaigns BEGIN
      UPDATE campaigns_fts 
      SET title = new.title, description = new.description 
      WHERE id = old.id;
    END;

    CREATE TABLE IF NOT EXISTS pledges (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id       TEXT NOT NULL,
      contributor       TEXT NOT NULL,
      amount            REAL NOT NULL,
      asset_code        TEXT NOT NULL,
      created_at        INTEGER NOT NULL,
      refunded_at       INTEGER,
      transaction_hash TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS campaign_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id         TEXT NOT NULL,
      event_type          TEXT NOT NULL,
      timestamp           INTEGER NOT NULL,
      actor               TEXT,
      amount              REAL,
      metadata            TEXT,
      blockchain_metadata TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pledges_campaign_id ON pledges(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON campaign_events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_events_timestamp ON campaign_events(timestamp);
  `);

  const pledgeColumns = database.prepare(`PRAGMA table_info(pledges)`).all() as Array<{
    name: string;
  }>;

  const hasTransactionHash = pledgeColumns.some((column) => column.name === 'transaction_hash');
  if (!hasTransactionHash) {
    database.exec(`ALTER TABLE pledges ADD COLUMN transaction_hash TEXT`);
  }

  const hasAssetCode = pledgeColumns.some((column) => column.name === 'asset_code');
  if (!hasAssetCode) {
    database.exec(`ALTER TABLE pledges ADD COLUMN asset_code TEXT NOT NULL DEFAULT 'XLM'`);
  }

  // Add deleted_at column if not exists
  const campaignColumns = database.prepare(`PRAGMA table_info(campaigns)`).all() as Array<{
    name: string;
  }>;
  if (!campaignColumns.some((column) => column.name === 'deleted_at')) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN deleted_at INTEGER`);
  }

  // Add failed_at column if not exists
  if (!campaignColumns.some((column) => column.name === 'failed_at')) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN failed_at INTEGER`);
  }

  // Migrate asset_code to accepted_tokens_json if needed
  if (
    campaignColumns.some((column) => column.name === 'asset_code') &&
    !campaignColumns.some((column) => column.name === 'accepted_tokens_json')
  ) {
    // 1. Create the FTS5 virtual table
database.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS campaigns_fts USING fts5(
    id,
    title,
    description
  );
`);

// 2. Add the Triggers to keep data synchronized automatically
database.exec(`
  -- Triggers for handling future changes
  CREATE TRIGGER IF NOT EXISTS after_campaigns_insert AFTER INSERT ON campaigns BEGIN
    INSERT INTO campaigns_fts(id, title, description) VALUES (new.id, new.title, new.description);
  END;

  CREATE TRIGGER IF NOT EXISTS after_campaigns_update AFTER UPDATE ON campaigns BEGIN
    UPDATE campaigns_fts SET title = new.title, description = new.description WHERE id = old.id;
  END;

  -- Fixes CodeRabbit: Delete trigger to prevent stale/corrupt terms
  CREATE TRIGGER IF NOT EXISTS after_campaigns_delete AFTER DELETE ON campaigns BEGIN
    DELETE FROM campaigns_fts WHERE id = old.id;
  END;
`);

// 3. Fixes CodeRabbit: Backfill any pre-existing campaigns into the FTS table
database.exec(`
  INSERT INTO campaigns_fts (id, title, description)
  SELECT id, title, description FROM campaigns
  WHERE id NOT IN (SELECT id FROM campaigns_fts);
`);

  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pledges_transaction_hash
    ON pledges(transaction_hash)
    WHERE transaction_hash IS NOT NULL
  `);

  try {
    database.exec(`ALTER TABLE campaign_events ADD COLUMN blockchain_metadata TEXT;`);
  } catch {
    // Column already exists, ignore error.
  }

  const hasMaxPerContributor = campaignColumns.some(
    (column) => column.name === 'max_per_contributor',
  );
  if (!hasMaxPerContributor) {
    database.exec(`ALTER TABLE campaigns ADD COLUMN max_per_contributor INTEGER`);
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaign_events_tx_hash
    ON campaign_events(json_extract(blockchain_metadata, '$.txHash'));
    CREATE INDEX IF NOT EXISTS idx_campaign_events_ledger
    ON campaign_events(json_extract(blockchain_metadata, '$.ledgerNumber'));
  `);
}
