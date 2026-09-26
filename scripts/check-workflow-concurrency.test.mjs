// Run with: node --test scripts/check-workflow-concurrency.test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONCURRENCY_BLOCK,
  EXEMPT,
  addBlock,
  checkWorkflow,
  triggers,
} from './check-workflow-concurrency.mjs';

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

const PR_WORKFLOW = ['name: Tests', '', 'on:', '  push:', '    branches: [main]', '  pull_request:', '', 'jobs:', '  test:', '    runs-on: ubuntu-latest', ''].join('\n');

test('every workflow in the repo satisfies the policy', () => {
  for (const name of readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file))) {
    const problems = checkWorkflow(name, readFileSync(join(WORKFLOWS_DIR, name), 'utf8'));
    assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  }
});

test('release, publish, and deploy workflows are exempt', () => {
  for (const name of ['release.yml', 'publish-ghcr.yml', 'contract-deployment.yml']) {
    assert.ok(EXEMPT.has(name), name);
  }
});

test('flags a PR-triggered workflow without the block', () => {
  assert.deepEqual(checkWorkflow('tests.yml', PR_WORKFLOW), ['missing the standard top-level concurrency block']);
});

test('flags a block that was edited away from the standard one', () => {
  const edited = addBlock(PR_WORKFLOW).replace('cancel-in-progress: true', 'cancel-in-progress: false');
  assert.deepEqual(checkWorkflow('tests.yml', edited), ['missing the standard top-level concurrency block']);
});

test('flags cancel-in-progress on an exempt release workflow', () => {
  const release = addBlock(PR_WORKFLOW);
  assert.deepEqual(checkWorkflow('release.yml', release), [
    'release/deploy workflow must not set cancel-in-progress',
  ]);
});

test('ignores schedule-only workflows', () => {
  const scheduled = ['name: Nightly', 'on:', '  schedule:', "    - cron: '0 0 * * *'", 'jobs: {}', ''].join('\n');
  assert.deepEqual(checkWorkflow('nightly.yml', scheduled), []);
});

test('addBlock inserts before jobs and keeps CRLF line endings', () => {
  const crlf = PR_WORKFLOW.replace(/\n/g, '\r\n');
  const fixed = addBlock(crlf);
  assert.ok(!/[^\r]\n/.test(fixed), 'no bare LF introduced');
  const lines = fixed.split('\r\n');
  const start = lines.indexOf(CONCURRENCY_BLOCK[0]);
  assert.ok(start > lines.indexOf('on:'));
  assert.equal(lines[start + CONCURRENCY_BLOCK.length + 1], 'jobs:');
  assert.deepEqual(checkWorkflow('tests.yml', fixed), []);
});

test('reads inline and block trigger lists', () => {
  assert.deepEqual(triggers(['on: [push, pull_request]']), ['push', 'pull_request']);
  assert.deepEqual(triggers(PR_WORKFLOW.split('\n')), ['push', 'pull_request']);
});

test('main runs get a unique group; PRs and branches share one per PR/ref', () => {
  const group = CONCURRENCY_BLOCK.find((line) => line.trim().startsWith('group:'));
  assert.match(group, /github\.ref == 'refs\/heads\/main' && format\('run-\{0\}', github\.run_id\)/);
  assert.match(group, /\|\| github\.event\.pull_request\.number \|\| github\.ref/);
});
