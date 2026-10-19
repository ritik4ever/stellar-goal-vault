/**
 * Versioned SQL migration runner.
 *
 * Migrations live in `backend/migrations/` as `NNN_name.sql` (up) with a
 * matching `NNN_name.down.sql` (rollback). Versions must be contiguous from 1.
 * Applied versions are recorded in `schema_migrations` together with a checksum
 * of the up script, so an applied migration that is later edited is detected
 * instead of silently diverging from databases that already ran it.
 *
 * Each migration runs inside its own transaction. When called inside an outer
 * transaction (as `migrate()` does), better-sqlite3 turns these into
 * savepoints, so a failure rolls back the whole startup migration.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { SQLiteDatabase } from '../services/db';

type MigrationDatabase = SQLiteDatabase;

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: number;
}

export const MIGRATIONS_TABLE = 'schema_migrations';

const MIGRATION_FILE = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
const ROLLBACK_FILE = /^(\d{3,})_([a-z0-9_]+)\.down\.sql$/;

export function resolveMigrationsDir(): string {
  // src/db and dist/db both sit two levels below backend/.
  return process.env.MIGRATIONS_DIR || path.join(__dirname, '..', '..', 'migrations');
}

function checksumOf(sql: string): string {
  // Normalize line endings so a CRLF checkout does not look like an edit.
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Reads and validates every migration in `dir`, sorted by version.
 * Throws if versions are duplicated, non-contiguous, or missing a rollback.
 */
export function loadMigrations(dir: string = resolveMigrationsDir()): Migration[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir);
  const ups = new Map<number, { name: string; file: string }>();
  const downs = new Map<number, { name: string; file: string }>();

  for (const file of files) {
    const down = ROLLBACK_FILE.exec(file);
    const up = down ? null : MIGRATION_FILE.exec(file);
    const match = down ?? up;
    if (!match) {
      continue;
    }

    const version = Number(match[1]);
    const target = down ? downs : ups;
    const existing = target.get(version);
    if (existing) {
      throw new Error(`Duplicate migration version ${version}: ${existing.file} and ${file}`);
    }
    target.set(version, { name: match[2], file });
  }

  for (const [version, down] of downs) {
    if (!ups.has(version)) {
      throw new Error(`Rollback ${down.file} has no matching migration`);
    }
  }

  const versions = [...ups.keys()].sort((a, b) => a - b);
  return versions.map((version, index) => {
    const up = ups.get(version)!;
    if (version !== index + 1) {
      throw new Error(
        `Migration versions must be contiguous from 1: expected ${index + 1}, found ${up.file}`,
      );
    }

    const down = downs.get(version);
    if (!down || down.name !== up.name) {
      throw new Error(
        `Migration ${up.file} is missing its rollback ${version.toString().padStart(3, '0')}_${up.name}.down.sql`,
      );
    }

    const upSql = fs.readFileSync(path.join(dir, up.file), 'utf8');
    return {
      version,
      name: up.name,
      up: upSql,
      down: fs.readFileSync(path.join(dir, down.file), 'utf8'),
      checksum: checksumOf(upSql),
    };
  });
}

export function ensureMigrationsTable(database: MigrationDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

export function getAppliedMigrations(database: MigrationDatabase): AppliedMigration[] {
  ensureMigrationsTable(database);
  return database
    .prepare(
      `SELECT version, name, checksum, applied_at AS appliedAt
       FROM ${MIGRATIONS_TABLE}
       ORDER BY version ASC`,
    )
    .all() as AppliedMigration[];
}

/** Highest applied migration version, or 0 for an unmigrated database. */
export function getSchemaVersion(database: MigrationDatabase): number {
  const applied = getAppliedMigrations(database);
  return applied.length === 0 ? 0 : applied[applied.length - 1].version;
}

function recordMigration(database: MigrationDatabase, migration: Migration): void {
  database
    .prepare(
      `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(migration.version, migration.name, migration.checksum, Date.now());
}

function assertAppliedMatch(applied: AppliedMigration[], migrations: Migration[]): void {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const row of applied) {
    const migration = byVersion.get(row.version);
    if (!migration) {
      throw new Error(
        `Database has migration ${row.version} (${row.name}) applied, but no such migration file exists`,
      );
    }
    if (migration.checksum !== row.checksum) {
      throw new Error(
        `Migration ${row.version} (${row.name}) was modified after being applied; ` +
          'add a new migration instead of editing an applied one',
      );
    }
  }
}

/**
 * Records migrations as applied without executing them. Used to adopt
 * databases whose schema was already brought to that state by other means.
 */
export function markMigrationsApplied(database: MigrationDatabase, migrations: Migration[]): void {
  ensureMigrationsTable(database);
  database.transaction(() => {
    for (const migration of migrations) {
      recordMigration(database, migration);
    }
  })();
}

/**
 * Applies every migration not yet recorded in `schema_migrations`, in version
 * order. Already-applied migrations are skipped. Returns the applied versions.
 */
export function applyPendingMigrations(
  database: MigrationDatabase,
  migrations: Migration[] = loadMigrations(),
): number[] {
  const applied = getAppliedMigrations(database);
  assertAppliedMatch(applied, migrations);

  const appliedVersions = new Set(applied.map((row) => row.version));
  const pending = migrations.filter((migration) => !appliedVersions.has(migration.version));

  for (const migration of pending) {
    database.transaction(() => {
      try {
        database.exec(migration.up);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${migration.version}_${migration.name} failed: ${message}`);
      }
      recordMigration(database, migration);
    })();
  }

  return pending.map((migration) => migration.version);
}

/**
 * Rolls back applied migrations newer than `targetVersion`, newest first,
 * using each migration's `.down.sql`. Returns the rolled-back versions.
 */
export function rollbackMigrations(
  database: MigrationDatabase,
  targetVersion: number,
  migrations: Migration[] = loadMigrations(),
): number[] {
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`Invalid rollback target version: ${targetVersion}`);
  }

  const applied = getAppliedMigrations(database);
  assertAppliedMatch(applied, migrations);

  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const toRollBack = applied
    .filter((row) => row.version > targetVersion)
    .sort((a, b) => b.version - a.version)
    .map((row) => byVersion.get(row.version)!);

  database.transaction(() => {
    for (const migration of toRollBack) {
      try {
        database.exec(migration.down);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Rollback of ${migration.version}_${migration.name} failed: ${message}`);
      }
      database.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = ?`).run(migration.version);
    }
  })();

  return toRollBack.map((migration) => migration.version);
}
