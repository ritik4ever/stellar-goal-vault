import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB = path.join('/tmp', `sgv-wal-test-${process.pid}.db`);

describe('SQLite WAL configuration (#218)', () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB;
  });

  afterEach(async () => {
    const { resetDbForTests } = await import('./db');
    resetDbForTests();
    const fs = await import('fs');
    fs.rmSync(TEST_DB, { force: true });
    fs.rmSync(`${TEST_DB}-wal`, { force: true });
    fs.rmSync(`${TEST_DB}-shm`, { force: true });
  });

  it('enables WAL journal mode on init', async () => {
    const { initDb, getDb } = await import('./db');
    initDb();
    const row = getDb().pragma('journal_mode', { simple: true });
    expect(row).toBe('wal');
  });

  it('sets synchronous=NORMAL on init', async () => {
    const { initDb, getDb } = await import('./db');
    initDb();
    const row = getDb().pragma('synchronous', { simple: true });
    // 1 = NORMAL in SQLite pragma integer encoding
    expect(row).toBe(1);
  });

  it('enables foreign key enforcement on init', async () => {
    const { initDb, getDb } = await import('./db');
    initDb();
    const row = getDb().pragma('foreign_keys', { simple: true });
    expect(row).toBe(1);
  });

  it('creates the campaign comments table before its indexes', async () => {
    const { initDb, getDb } = await import('./db');
    initDb();

    const table = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'campaign_comments'")
      .get() as { name?: string } | undefined;
    const columns = getDb().prepare('PRAGMA table_info(campaign_comments)').all() as Array<{
      name: string;
    }>;

    expect(table?.name).toBe('campaign_comments');
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'campaign_id',
      'author',
      'content',
      'created_at',
      'deleted_at',
    ]);
  });
});
