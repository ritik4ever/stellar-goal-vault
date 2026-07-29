#!/usr/bin/env node
/**
 * Chaos test: kill the backend mid-pledge, restart it, assert the campaign
 * pledge total is still consistent and that SQLite recovered its WAL.
 *
 * Run with: npm run test:chaos
 *
 * Scenario
 *   1. Boot the backend against a throwaway SQLite file (WAL mode).
 *   2. Create a campaign, then fire N concurrent pledges with unique amounts.
 *   3. SIGKILL the backend 200ms later (no graceful shutdown, no checkpoint).
 *   4. Assert a non-empty `-wal` file was left behind (unclean shutdown).
 *   5. Restart the backend so SQLite replays/recovers the WAL.
 *   6. Assert: every acknowledged pledge survived exactly once, no pledge row
 *      is duplicated, campaigns.pledged_amount == SUM(pledges.amount), the API
 *      agrees with the file, journal_mode is still wal and integrity_check ok.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BACKEND_DIR = path.join(ROOT, 'backend');

const PORT = Number(process.env.CHAOS_PORT ?? 4599);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(HERE, '.chaos-data');
const DB_PATH = path.join(DATA_DIR, 'chaos.db');
const PLEDGE_COUNT = Number(process.env.CHAOS_PLEDGES ?? 12);
const KILL_AFTER_MS = Number(process.env.CHAOS_KILL_AFTER_MS ?? 200);
const BOOT_TIMEOUT_MS = 45_000;

const CREATOR = padAccount('GCHAOSCREATOR');
const CONTRIBUTOR = padAccount('GCHAOSCONTRIBUTOR');

const failures = [];
let backend = null;

function padAccount(prefix) {
  return (prefix + 'A'.repeat(56)).slice(0, 56);
}

function step(message) {
  console.log(`\n▶ ${message}`);
}

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
    return true;
  }
  console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  failures.push(detail ? `${label} — ${detail}` : label);
  return false;
}

function resolveEntrypoint() {
  const dist = path.join(BACKEND_DIR, 'dist', 'index.js');
  if (fs.existsSync(dist)) {
    return { args: [dist], mode: 'dist' };
  }

  const tsNode = path.join(BACKEND_DIR, 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (fs.existsSync(tsNode)) {
    return {
      args: [tsNode, '--transpile-only', path.join(BACKEND_DIR, 'src', 'index.ts')],
      mode: 'ts-node',
    };
  }

  throw new Error(
    'No backend entrypoint found. Run `npm install` in backend/ (ts-node) or `npm run build` first.',
  );
}

function startBackend(label) {
  const { args, mode } = resolveEntrypoint();
  const child = spawn(process.execPath, args, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      DB_PATH,
      LOG_LEVEL: 'error',
      CONTRACT_ID: process.env.CONTRACT_ID ?? 'CHAOS_TEST_CONTRACT',
      API_KEYS: '',
      ALLOWED_ASSETS: 'XLM,USDC',
      DEFAULT_MAX_PER_CONTRIBUTOR: '0',
      RATE_LIMIT_WRITE_LIMIT: '10000',
      RATE_LIMIT_READ_LIMIT: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.logs = '';
  const collect = (chunk) => {
    child.logs += chunk.toString();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', collect);

  console.log(`  · started ${label} (${mode}, pid ${child.pid}) on ${BASE_URL}`);
  return child;
}

async function waitForHealth(child, timeoutMs = BOOT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early (code ${child.exitCode}):\n${child.logs}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    await delay(200);
  }
  throw new Error(`backend did not become healthy within ${timeoutMs}ms:\n${child.logs}`);
}

async function killHard(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
  await Promise.race([exited, delay(5000)]);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

function openDb() {
  const requireFromBackend = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const Database = requireFromBackend('better-sqlite3');
  return new Database(DB_PATH);
}

function cleanDataDir() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function run() {
  step('Preparing throwaway database');
  cleanDataDir();
  console.log(`  · DB_PATH=${DB_PATH}`);

  step('Booting backend (run #1)');
  backend = startBackend('backend#1');
  await waitForHealth(backend);

  step('Creating campaign');
  const created = await postJson(`${BASE_URL}/api/campaigns`, {
    creator: CREATOR,
    title: 'Chaos campaign',
    description: 'Campaign used by the chaos kill-mid-pledge test.',
    acceptedTokens: ['XLM'],
    targetAmount: 100_000,
    deadline: Math.floor(Date.now() / 1000) + 86_400,
  });
  if (created.status !== 201) {
    throw new Error(`campaign creation failed (${created.status}): ${JSON.stringify(created.payload)}`);
  }
  const campaignId = String(created.payload.data.id);
  console.log(`  · campaign id ${campaignId}`);

  step(`Firing ${PLEDGE_COUNT} pledges, killing backend after ${KILL_AFTER_MS}ms`);
  // Unique amounts make every pledge individually identifiable in the DB, so a
  // lost pledge and a double-counted pledge are both detectable.
  const amounts = Array.from({ length: PLEDGE_COUNT }, (_, index) =>
    Number((1 + (index + 1) / 100).toFixed(2)),
  );

  const inFlight = amounts.map((amount) =>
    postJson(`${BASE_URL}/api/campaigns/${campaignId}/pledges`, {
      contributor: CONTRIBUTOR,
      amount,
      assetCode: 'XLM',
    })
      .then((result) => ({ amount, status: result.status }))
      .catch(() => ({ amount, status: 0 })),
  );

  await delay(KILL_AFTER_MS);
  await killHard(backend);
  const results = await Promise.all(inFlight);
  backend = null;

  const acked = results.filter((result) => result.status === 201).map((result) => result.amount);
  const unknown = results.filter((result) => result.status !== 201).map((result) => result.amount);
  console.log(`  · ${acked.length} acknowledged, ${unknown.length} killed in flight`);

  step('Verifying unclean shutdown left a WAL to recover');
  const walPath = `${DB_PATH}-wal`;
  const walExists = fs.existsSync(walPath);
  const walSize = walExists ? fs.statSync(walPath).size : 0;
  check('WAL file present after SIGKILL', walExists, `expected ${walPath}`);
  check('WAL file is non-empty (uncheckpointed frames)', walSize > 0, `size=${walSize}`);
  check(
    'No graceful shutdown ran (no clean checkpoint)',
    !fs.existsSync(`${DB_PATH}-shm`) || walSize > 0,
    'expected leftover WAL/-shm state',
  );

  step('Restarting backend (run #2) — SQLite recovers the WAL on open');
  backend = startBackend('backend#2');
  await waitForHealth(backend);

  step('Verifying pledge totals are consistent after recovery');
  const campaignResponse = await fetch(`${BASE_URL}/api/campaigns/${campaignId}`);
  const campaignBody = await campaignResponse.json();
  const apiTotal = Number(campaignBody?.data?.pledgedAmount ?? NaN);

  const db = openDb();
  try {
    const journalMode = db.pragma('journal_mode', { simple: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const rows = db
      .prepare(`SELECT amount FROM pledges WHERE campaign_id = ? AND refunded_at IS NULL`)
      .all(campaignId);
    const storedTotalRow = db
      .prepare(`SELECT pledged_amount AS total FROM campaigns WHERE id = ?`)
      .get(campaignId);

    const counts = new Map();
    for (const row of rows) {
      const amount = Number(row.amount);
      counts.set(amount, (counts.get(amount) ?? 0) + 1);
    }

    const rowSum = Number(
      rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2),
    );
    const storedTotal = Number(Number(storedTotalRow?.total ?? NaN).toFixed(2));

    check('journal_mode is still WAL after recovery', journalMode === 'wal', `got ${journalMode}`);
    check('integrity_check reports ok', integrity === 'ok', `got ${integrity}`);

    const duplicated = [...counts.entries()].filter(([, count]) => count > 1);
    check(
      'No pledge double-counted',
      duplicated.length === 0,
      duplicated.map(([amount, count]) => `${amount}×${count}`).join(', '),
    );

    const lost = acked.filter((amount) => (counts.get(amount) ?? 0) !== 1);
    check(
      'No acknowledged pledge lost',
      lost.length === 0,
      lost.length ? `missing amounts: ${lost.join(', ')}` : '',
    );

    check(
      'campaigns.pledged_amount matches SUM(pledges.amount)',
      Math.abs(storedTotal - rowSum) < 0.005,
      `stored=${storedTotal} rows=${rowSum}`,
    );

    check(
      'API total matches recovered database total',
      Number.isFinite(apiTotal) && Math.abs(apiTotal - rowSum) < 0.005,
      `api=${apiTotal} rows=${rowSum}`,
    );

    console.log(
      `  · recovered ${rows.length} pledge rows, total ${rowSum} (${acked.length} acknowledged, ${unknown.length} in flight)`,
    );
  } finally {
    db.close();
  }
}

try {
  await run();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  await killHard(backend);
}

console.log('\n────────────────────────────────');
if (failures.length === 0) {
  console.log('CHAOS TEST PASSED — pledge totals consistent, WAL recovered.');
  process.exit(0);
}

console.log(`CHAOS TEST FAILED (${failures.length})`);
for (const failure of failures) {
  console.log(`  - ${failure}`);
}
process.exit(1);
