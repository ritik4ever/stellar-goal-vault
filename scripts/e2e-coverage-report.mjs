#!/usr/bin/env node
/**
 * Merge Playwright V8 JS coverage dumps and publish focused coverage output.
 * Enforces the repository lines threshold (default 80) — never weaken it here.
 *
 * Usage:
 *   node scripts/e2e-coverage-report.mjs
 *   node scripts/e2e-coverage-report.mjs --raw-dir coverage/e2e/raw --out-dir coverage/e2e
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function loadThreshold(thresholdPath = path.join(ROOT, 'e2e', 'coverage-threshold.json')) {
  const raw = JSON.parse(fs.readFileSync(thresholdPath, 'utf8'));
  const lines = Number(raw.lines);
  if (!Number.isFinite(lines) || lines < 80) {
    throw new Error(
      `E2E coverage lines threshold must be >= 80 (repository standard); got ${raw.lines}`,
    );
  }
  return { lines };
}

export function isFocusedUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('nodejs:') || url.startsWith('ws:') || url.startsWith('chrome-extension:')) {
    return false;
  }
  if (url.includes('node_modules') || url.includes('playwright')) return false;
  if (url.includes('@vite') || url.includes('vite/dist') || url.includes('vite/client')) {
    return false;
  }
  try {
    const u = new URL(url);
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return false;
    // Prefer app source and built assets; skip pure HTML document shells.
    if (u.pathname.endsWith('.html') && !u.pathname.includes('/src/')) return false;
    return (
      u.pathname.includes('/src/') ||
      u.pathname.includes('/assets/') ||
      u.pathname.endsWith('.js') ||
      u.pathname.endsWith('.ts') ||
      u.pathname.endsWith('.tsx') ||
      u.pathname.endsWith('.mjs') ||
      u.pathname.endsWith('.jsx')
    );
  } catch {
    return false;
  }
}

function offsetToLine(source, offset) {
  if (!source) return 1;
  let line = 1;
  const max = Math.min(offset, source.length);
  for (let i = 0; i < max; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Compute focused line coverage from Playwright/CDP JS coverage entries.
 */
export function computeLineCoverage(entries) {
  /** @type {Map<string, { covered: Set<number>, total: Set<number> }>} */
  const perFile = new Map();

  for (const entry of entries) {
    if (!isFocusedUrl(entry.url)) continue;
    const source = entry.source || '';
    const totalLines = source
      ? source.split('\n').length
      : estimateLinesFromFunctions(entry.functions || []);
    if (totalLines <= 0) continue;

    let file = perFile.get(entry.url);
    if (!file) {
      file = { covered: new Set(), total: new Set() };
      perFile.set(entry.url, file);
    }
    for (let ln = 1; ln <= totalLines; ln++) {
      file.total.add(ln);
    }

    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        if (!range || range.count <= 0) continue;
        const startLine = offsetToLine(source, range.startOffset ?? 0);
        const endLine = offsetToLine(source, Math.max((range.endOffset ?? 0) - 1, 0));
        for (let ln = startLine; ln <= endLine; ln++) {
          file.covered.add(ln);
        }
      }
    }
  }

  let covered = 0;
  let total = 0;
  const files = [];
  for (const [url, file] of [...perFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const fileTotal = file.total.size;
    const fileCovered = [...file.covered].filter((ln) => file.total.has(ln)).length;
    covered += fileCovered;
    total += fileTotal;
    const pct = fileTotal === 0 ? 0 : (fileCovered / fileTotal) * 100;
    files.push({
      url,
      lines: { covered: fileCovered, total: fileTotal, pct: Number(pct.toFixed(2)) },
    });
  }

  const pct = total === 0 ? 0 : (covered / total) * 100;
  return {
    lines: { covered, total, pct: Number(pct.toFixed(2)) },
    files,
  };
}

function estimateLinesFromFunctions(functions) {
  let max = 0;
  for (const fn of functions) {
    for (const range of fn.ranges || []) {
      max = Math.max(max, range.endOffset || 0);
    }
  }
  // Rough fallback when source text is absent (minified bundles).
  return max > 0 ? Math.max(1, Math.ceil(max / 40)) : 0;
}

export function readRawCoverage(rawDir) {
  if (!fs.existsSync(rawDir)) return [];
  const files = fs.readdirSync(rawDir).filter((f) => f.endsWith('.json'));
  const entries = [];
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(rawDir, file), 'utf8'));
    if (Array.isArray(parsed)) entries.push(...parsed);
  }
  return entries;
}

export function formatTextReport(summary, threshold) {
  const lines = [];
  lines.push('Playwright E2E focused coverage');
  lines.push('================================');
  lines.push(
    `Lines: ${summary.lines.covered}/${summary.lines.total} (${summary.lines.pct.toFixed(2)}%)`,
  );
  lines.push(`Threshold: ${threshold.lines}% lines (repository standard)`);
  lines.push('');
  if (!summary.files.length) {
    lines.push('No focused application scripts were present in the coverage dump.');
  } else {
    lines.push('Per-file (focused):');
    for (const f of summary.files) {
      lines.push(
        `  ${f.lines.pct.toFixed(1).padStart(6)}%  ${f.lines.covered}/${f.lines.total}  ${f.url}`,
      );
    }
  }
  return lines.join('\n');
}

export function enforceThreshold(summary, threshold, { allowEmpty = false } = {}) {
  if (summary.lines.total === 0) {
    if (allowEmpty) {
      return { ok: true, reason: 'empty-allowed' };
    }
    return {
      ok: false,
      reason: 'No focused coverage data found. Run E2E with E2E_COVERAGE=1 (or CI=true).',
    };
  }
  if (summary.lines.pct + 1e-9 < threshold.lines) {
    return {
      ok: false,
      reason: `Coverage ${summary.lines.pct.toFixed(2)}% is below the ${threshold.lines}% lines threshold`,
    };
  }
  return { ok: true, reason: 'pass' };
}

export function writeReports(outDir, summary, threshold, text) {
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    threshold,
    total: summary.lines,
    files: summary.files,
  };
  fs.writeFileSync(path.join(outDir, 'coverage-summary.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(outDir, 'coverage.txt'), text + '\n');
  // Minimal LCOV for artifact consumers / CI upload parity with unit suites.
  const lcov = summary.files
    .map((f, idx) => {
      const sf = f.url;
      const parts = [`TN:e2e`, `SF:${sf}`, `LF:${f.lines.total}`, `LH:${f.lines.covered}`];
      for (let ln = 1; ln <= f.lines.total; ln++) {
        // We only know aggregate counts; mark covered lines as 1 when overall file has coverage.
        const hit = ln <= f.lines.covered ? 1 : 0;
        parts.push(`DA:${ln},${hit}`);
      }
      parts.push('end_of_record');
      return parts.join('\n');
    })
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'lcov.info'), lcov + (lcov ? '\n' : ''));
  return payload;
}

function parseArgs(argv) {
  const args = {
    rawDir: path.join(ROOT, 'coverage', 'e2e', 'raw'),
    outDir: path.join(ROOT, 'coverage', 'e2e'),
    thresholdPath: path.join(ROOT, 'e2e', 'coverage-threshold.json'),
    allowEmpty: process.env.E2E_COVERAGE_ALLOW_EMPTY === '1',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--raw-dir') args.rawDir = path.resolve(argv[++i]);
    else if (a === '--out-dir') args.outDir = path.resolve(argv[++i]);
    else if (a === '--threshold') args.thresholdPath = path.resolve(argv[++i]);
    else if (a === '--allow-empty') args.allowEmpty = true;
  }
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const threshold = loadThreshold(args.thresholdPath);
  const entries = readRawCoverage(args.rawDir);
  const summary = computeLineCoverage(entries);
  const text = formatTextReport(summary, threshold);
  writeReports(args.outDir, summary, threshold, text);
  console.log(text);
  const result = enforceThreshold(summary, threshold, { allowEmpty: args.allowEmpty });
  if (!result.ok) {
    console.error(`\nERROR: ${result.reason}`);
    return 1;
  }
  console.log(`\nThreshold check: ${result.reason}`);
  return 0;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  process.exit(runCli());
}
