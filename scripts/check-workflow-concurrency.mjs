#!/usr/bin/env node
/**
 * Guards the CI concurrency policy described in docs/CI.md.
 *
 * - Every workflow triggered by `pull_request` or `push` must declare the
 *   standard `concurrency` block, so a new commit cancels the superseded run
 *   for the same PR or branch.
 * - Release, publish, and deploy workflows are exempt and must never set
 *   `cancel-in-progress`, so an in-flight release or deployment is never
 *   interrupted.
 *
 * Usage:
 *   node scripts/check-workflow-concurrency.mjs          # check (CI)
 *   node scripts/check-workflow-concurrency.mjs --fix    # add the block where missing
 *
 * No dependencies: the checks are line-based on purpose, and the block is
 * matched exactly so the policy can't drift workflow by workflow.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/** Never cancelled: releases, image publishing, and deployments. */
export const EXEMPT = new Set([
  'release.yml',
  'publish-ghcr.yml',
  'contract-deployment.yml',
  'load-test.yml', // schedule / manual only
  'fuzz.yml', // no triggers
]);

export const CONCURRENCY_BLOCK = [
  '# Cancel superseded runs for the same PR or branch. Runs on main get a',
  '# unique group, so they are never cancelled or queued. See docs/CI.md.',
  'concurrency:',
  "  group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && format('run-{0}', github.run_id) || github.event.pull_request.number || github.ref }}",
  '  cancel-in-progress: true',
];

/** Top-level trigger names under `on:` (handles block and inline forms). */
export function triggers(lines) {
  const onIndex = lines.findIndex((line) => /^on:/.test(line));
  if (onIndex === -1) return [];
  const inline = lines[onIndex].slice(3).trim();
  if (inline) {
    return inline.replace(/[[\]]/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  }
  const names = [];
  for (const line of lines.slice(onIndex + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([a-z_]+):/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

export function hasBlock(lines) {
  const start = lines.indexOf(CONCURRENCY_BLOCK[0]);
  return start !== -1 && CONCURRENCY_BLOCK.every((line, i) => lines[start + i] === line);
}

export function checkWorkflow(name, text) {
  const lines = text.split(/\r?\n/);
  const problems = [];

  if (EXEMPT.has(name)) {
    if (lines.some((line) => /cancel-in-progress:\s*(true|\$\{\{)/.test(line))) {
      problems.push('release/deploy workflow must not set cancel-in-progress');
    }
    return problems;
  }

  const on = triggers(lines);
  if (!on.includes('pull_request') && !on.includes('push')) return problems;

  if (!hasBlock(lines)) {
    problems.push('missing the standard top-level concurrency block');
  }
  if (lines.filter((line) => /^concurrency:/.test(line)).length > 1) {
    problems.push('declares more than one top-level concurrency block');
  }
  return problems;
}

/** Insert the block right before the top-level `jobs:` key, keeping line endings. */
export function addBlock(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const jobsIndex = lines.findIndex((line) => /^jobs:/.test(line));
  if (jobsIndex === -1) throw new Error('no top-level jobs: key');
  lines.splice(jobsIndex, 0, ...CONCURRENCY_BLOCK, '');
  return lines.join(eol);
}

function main() {
  const fix = process.argv.includes('--fix');
  const files = readdirSync(WORKFLOWS_DIR).filter((name) => /\.ya?ml$/.test(name)).sort();
  let failed = false;

  for (const name of files) {
    const path = join(WORKFLOWS_DIR, name);
    let text = readFileSync(path, 'utf8');
    let problems = checkWorkflow(name, text);

    if (fix && problems.includes('missing the standard top-level concurrency block')) {
      text = addBlock(text);
      writeFileSync(path, text);
      console.log(`fixed ${name}`);
      problems = checkWorkflow(name, text);
    }

    for (const problem of problems) {
      failed = true;
      console.error(`${name}: ${problem}`);
    }
  }

  if (failed) {
    console.error('\nSee docs/CI.md for the workflow concurrency policy.');
    process.exit(1);
  }
  console.log(`workflow concurrency OK (${files.length} workflows checked)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
