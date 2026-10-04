#!/usr/bin/env node
/**
 * coverage-summary.mjs — Publish a focused coverage summary for the backend
 * API integration suite.
 *
 * Reads the Istanbul-format report emitted by Vitest's v8 coverage provider
 * (`coverage/coverage-final.json`) and prints a Markdown summary with the
 * overall statement/branch/function/line percentages plus the lowest-covered
 * files. The same Markdown is appended to `$GITHUB_STEP_SUMMARY` when running
 * in GitHub Actions so coverage regressions are visible directly on the PR.
 *
 * This script never fails the build: the enforced coverage threshold lives in
 * `vitest.config.ts` (currently `lines: 80`) and is intentionally left as-is.
 */
import fs from "node:fs";
import path from "node:path";

const COVERAGE_FILE =
  process.env.COVERAGE_FILE ||
  path.join(process.cwd(), "coverage", "coverage-final.json");

/** Percentage rounded to two decimals; 100 when there is nothing to cover. */
function pct(covered, total) {
  if (!total) return 100;
  return Math.round((covered / total) * 10000) / 100;
}

function summarizeFile(file) {
  const statements = Object.values(file.s ?? {});
  const functions = Object.values(file.f ?? {});

  let branchTotal = 0;
  let branchCovered = 0;
  for (const hits of Object.values(file.b ?? {})) {
    for (const hit of hits) {
      branchTotal += 1;
      if (hit > 0) branchCovered += 1;
    }
  }

  // Aggregate statement hits per source line to derive line coverage.
  const lineHits = new Map();
  for (const [id, statement] of Object.entries(file.statementMap ?? {})) {
    const line = statement?.start?.line;
    if (line === undefined) continue;
    lineHits.set(line, (lineHits.get(line) ?? 0) + (file.s?.[id] ?? 0));
  }

  return {
    statements: { covered: statements.filter((h) => h > 0).length, total: statements.length },
    functions: { covered: functions.filter((h) => h > 0).length, total: functions.length },
    branches: { covered: branchCovered, total: branchTotal },
    lines: {
      covered: [...lineHits.values()].filter((h) => h > 0).length,
      total: lineHits.size,
    },
  };
}

function addMetric(target, key, value) {
  target[key].covered += value.covered;
  target[key].total += value.total;
}

function metricRow(label, metric) {
  const value = pct(metric.covered, metric.total);
  const icon = value >= 80 ? "✅" : value >= 60 ? "⚠️" : "❌";
  return `| ${label} | ${value}% | ${metric.covered}/${metric.total} | ${icon} |`;
}

function buildSummary(report) {
  const entries = Object.entries(report);
  const totals = {
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };

  const perFile = entries.map(([file, coverage]) => {
    const summary = summarizeFile(coverage);
    for (const key of Object.keys(totals)) addMetric(totals, key, summary[key]);
    return { file, summary };
  });

  const lines = [];
  lines.push("## Backend API coverage");
  lines.push("");
  lines.push("| Metric | Coverage | Covered / Total | Status |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(metricRow("Statements", totals.statements));
  lines.push(metricRow("Branches", totals.branches));
  lines.push(metricRow("Functions", totals.functions));
  lines.push(metricRow("Lines", totals.lines));
  lines.push("");

  const lowest = perFile
    .map((entry) => ({
      file: entry.file.replace(`${process.cwd()}${path.sep}`, ""),
      value: pct(entry.summary.lines.covered, entry.summary.lines.total),
      lines: entry.summary.lines,
    }))
    .filter((entry) => entry.lines.total > 0)
    .sort((a, b) => a.value - b.value)
    .slice(0, 10);

  if (lowest.length > 0) {
    lines.push("### Lowest-covered files");
    lines.push("");
    lines.push("| File | Line Coverage |");
    lines.push("| --- | --- |");
    for (const entry of lowest) {
      lines.push(`| \`${entry.file}\` | ${entry.value}% (${entry.lines.covered}/${entry.lines.total}) |`);
    }
    lines.push("");
  }

  lines.push(
    "_The enforced threshold (`lines: 80`) lives in `backend/vitest.config.ts`; this summary only reports._"
  );
  lines.push("");
  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(COVERAGE_FILE)) {
    console.log(`No coverage report found at ${COVERAGE_FILE} — skipping summary.`);
    return;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(COVERAGE_FILE, "utf8"));
  } catch (error) {
    console.log(`Could not parse ${COVERAGE_FILE}: ${error.message} — skipping summary.`);
    return;
  }

  const markdown = buildSummary(report);
  console.log(markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
}

main();
