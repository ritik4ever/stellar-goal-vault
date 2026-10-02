import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(__dirname, 'e2e-coverage-report.mjs')).href);

const {
  isFocusedUrl,
  computeLineCoverage,
  enforceThreshold,
  loadThreshold,
  formatTextReport,
  writeReports,
} = mod;

test('isFocusedUrl keeps app source and drops tooling', () => {
  assert.equal(isFocusedUrl('http://localhost:3000/src/App.tsx'), true);
  assert.equal(isFocusedUrl('http://127.0.0.1:3000/assets/index-abc.js'), true);
  assert.equal(isFocusedUrl('http://localhost:3000/@vite/client'), false);
  assert.equal(isFocusedUrl('http://localhost:3000/node_modules/foo.js'), false);
  assert.equal(isFocusedUrl('https://cdn.example/app.js'), false);
});

test('computeLineCoverage reports focused line percentages', () => {
  const source = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
  // Cover first 4 lines via one range (offsets into source).
  const end = source.split('\n').slice(0, 4).join('\n').length;
  const entries = [
    {
      url: 'http://localhost:3000/src/components/CampaignBoard.tsx',
      source,
      functions: [
        {
          functionName: 'render',
          ranges: [{ startOffset: 0, endOffset: end, count: 3 }],
        },
      ],
    },
    {
      url: 'http://localhost:3000/@vite/client',
      source: 'ignored',
      functions: [{ functionName: 'x', ranges: [{ startOffset: 0, endOffset: 7, count: 1 }] }],
    },
  ];
  const summary = computeLineCoverage(entries);
  assert.equal(summary.files.length, 1);
  assert.ok(summary.lines.total >= 4);
  assert.ok(summary.lines.pct >= 80);
});

test('enforceThreshold preserves repository 80% gate', () => {
  const pass = enforceThreshold(
    { lines: { covered: 80, total: 100, pct: 80 }, files: [{}] },
    { lines: 80 },
  );
  assert.equal(pass.ok, true);

  const fail = enforceThreshold(
    { lines: { covered: 79, total: 100, pct: 79 }, files: [{}] },
    { lines: 80 },
  );
  assert.equal(fail.ok, false);
  assert.match(fail.reason, /below the 80%/);
});

test('loadThreshold rejects weakened thresholds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cov-'));
  const weak = path.join(dir, 'threshold.json');
  fs.writeFileSync(weak, JSON.stringify({ lines: 50 }));
  assert.throws(() => loadThreshold(weak), /must be >= 80/);
});

test('writeReports publishes focused coverage artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cov-out-'));
  const summary = {
    lines: { covered: 8, total: 10, pct: 80 },
    files: [
      {
        url: 'http://localhost:3000/src/App.tsx',
        lines: { covered: 8, total: 10, pct: 80 },
      },
    ],
  };
  const threshold = { lines: 80 };
  const text = formatTextReport(summary, threshold);
  const payload = writeReports(dir, summary, threshold, text);
  assert.equal(payload.threshold.lines, 80);
  assert.ok(fs.existsSync(path.join(dir, 'coverage-summary.json')));
  assert.ok(fs.existsSync(path.join(dir, 'coverage.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'lcov.info')));
  assert.match(fs.readFileSync(path.join(dir, 'coverage.txt'), 'utf8'), /80%/);
});
