import { getDb } from './db';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const SALT_ROUNDS = 10;
const KEY_PREFIX_LENGTH = 8;

export type ApiKeyScope = 'read-only' | 'read-write';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scope: ApiKeyScope;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  rotatedFrom: string | null;
  gracePeriodEndsAt: number | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scope: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
  rotated_from: string | null;
  grace_period_ends_at: number | null;
}

function rowToApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    scope: row.scope as ApiKeyScope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    rotatedFrom: row.rotated_from,
    gracePeriodEndsAt: row.grace_period_ends_at,
  };
}

export interface CreateApiKeyInput {
  name: string;
  scope: ApiKeyScope;
  expiresInDays?: number;
}

export interface RotateApiKeyInput {
  gracePeriodDays?: number;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  plainKey: string;
  scope: ApiKeyScope;
  createdAt: number;
  expiresAt: number | null;
}

export function generateApiKey(): { plainKey: string; prefix: string; hash: string } {
  const plainKey = randomBytes(24).toString('base64url');
  const prefix = plainKey.slice(0, KEY_PREFIX_LENGTH);
  return {
    plainKey,
    prefix,
    hash: bcrypt.hashSync(plainKey, SALT_ROUNDS),
  };
}

export function createApiKey(input: CreateApiKeyInput): CreatedApiKey {
  const db = getDb();
  const { plainKey, prefix, hash } = generateApiKey();

  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? Math.floor(Date.now() / 1000) + input.expiresInDays * 24 * 60 * 60
      : null;

  const id = randomBytes(16).toString('hex');

  db.prepare(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, scope, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, prefix, hash, input.scope, Math.floor(Date.now() / 1000), expiresAt);

  return {
    id,
    name: input.name,
    keyPrefix: prefix,
    plainKey,
    scope: input.scope,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt,
  };
}

export function listApiKeys(): ApiKeyRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, key_prefix, key_hash, scope, created_at, expires_at, revoked_at, last_used_at, rotated_from, grace_period_ends_at
       FROM api_keys
       WHERE revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all() as ApiKeyRow[];

  return rows.map(rowToApiKey);
}

export function revokeApiKey(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare(`UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(Math.floor(Date.now() / 1000), id);

  return result.changes > 0;
}

export function rotateApiKey(id: string, input: RotateApiKeyInput = {}): CreatedApiKey | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Get the existing key
  const oldKeyRow = db
    .prepare(
      `SELECT id, name, key_prefix, key_hash, scope, created_at, expires_at, revoked_at, last_used_at, rotated_from, grace_period_ends_at
       FROM api_keys
       WHERE id = ?`,
    )
    .get(id) as ApiKeyRow | undefined;

  if (!oldKeyRow) {
    return null;
  }

  if (oldKeyRow.revoked_at !== null) {
    return null; // Cannot rotate a revoked key
  }

  // Generate new key
  const { plainKey, prefix, hash } = generateApiKey();

  // Calculate grace period end (default 7 days)
  const gracePeriodDays =
    input.gracePeriodDays && input.gracePeriodDays > 0 ? input.gracePeriodDays : 7;
  const gracePeriodEndsAt = now + gracePeriodDays * 24 * 60 * 60;

  const newId = randomBytes(16).toString('hex');

  // Create new key with rotated_from pointing to old key
  db.prepare(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, scope, created_at, expires_at, rotated_from, grace_period_ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId,
    oldKeyRow.name,
    prefix,
    hash,
    oldKeyRow.scope,
    now,
    oldKeyRow.expires_at,
    oldKeyRow.id,
    gracePeriodEndsAt,
  );

  // Update old key: set grace_period_ends_at and mark as rotated
  db.prepare(`UPDATE api_keys SET grace_period_ends_at = ? WHERE id = ?`).run(
    gracePeriodEndsAt,
    id,
  );

  return {
    id: newId,
    name: oldKeyRow.name,
    keyPrefix: prefix,
    plainKey,
    scope: oldKeyRow.scope as ApiKeyScope,
    createdAt: now,
    expiresAt: oldKeyRow.expires_at,
  };
}

export function validateApiKey(plainKey: string): ApiKeyRecord | null {
  const db = getDb();
  const prefix = plainKey.slice(0, KEY_PREFIX_LENGTH);

  const rows = db
    .prepare(
      `SELECT id, name, key_prefix, key_hash, scope, created_at, expires_at, revoked_at, last_used_at, rotated_from, grace_period_ends_at
       FROM api_keys
       WHERE key_prefix = ? AND revoked_at IS NULL`,
    )
    .all(prefix) as ApiKeyRow[];

  const now = Math.floor(Date.now() / 1000);

  for (const row of rows) {
    if (bcrypt.compareSync(plainKey, row.key_hash)) {
      // Check expiration
      if (row.expires_at && row.expires_at < now) {
        return null;
      }

      // Check grace period - if key has grace_period_ends_at and it's past, the key is no longer valid
      if (row.grace_period_ends_at && row.grace_period_ends_at < now) {
        return null;
      }

      db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(now, row.id);
      return rowToApiKey(row);
    }
  }

  return null;
}

export function updateApiKeyLastUsed(id: string): void {
  const db = getDb();
  db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(
    Math.floor(Date.now() / 1000),
    id,
  );
}

export function isKeyExpired(key: ApiKeyRecord): boolean {
  return key.expiresAt !== null && key.expiresAt < Math.floor(Date.now() / 1000);
}

export function isReadOnlyKey(key: ApiKeyRecord): boolean {
  return key.scope === 'read-only';
}
