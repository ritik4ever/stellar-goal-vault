/**
 * Generates TypeScript bindings from the deployed Soroban contract ABI.
 * Run with: npm run gen:bindings
 * Drift check only (no network): npm run gen:bindings:check
 *
 * Uses `stellar contract bindings typescript` CLI to auto-generate
 * typed bindings and outputs them to frontend/src/generated/
 *
 * Rerun safety:
 * - The contract ID comes from CONTRACT_ID or contracts/contract_id.txt,
 *   never from a silent placeholder.
 * - Bindings are generated into a temp dir and only copied into
 *   frontend/src/generated/ on success, so a failed run changes nothing.
 * - frontend/src/generated/.contract-id records which contract the bindings
 *   came from, so CI can report drift.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BindingsError,
  STAMP_FILE,
  checkBindingsDrift,
  renderStamp,
  resolveContractId,
} from './bindings-guard';

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'frontend/src/generated');
const CONTRACT_ID_FILE = path.join(ROOT, 'contracts/contract_id.txt');
const STAMP_PATH = path.join(OUTPUT_DIR, STAMP_FILE);
const NETWORK = process.env.NETWORK || 'testnet';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const { id: contractId, source } = resolveContractId(
    process.env.CONTRACT_ID,
    readIfExists(CONTRACT_ID_FILE),
  );

  if (checkOnly) {
    const result = checkBindingsDrift(readIfExists(STAMP_PATH), contractId);
    if (result.status === 'drift') {
      console.error(result.message);
      process.exit(1);
    }
    console.log(result.message);
    return;
  }

  const from = source === 'env' ? 'CONTRACT_ID' : 'contracts/contract_id.txt';
  console.log('Generating TypeScript bindings...');
  console.log(`Contract ID: ${contractId} (from ${from})`);
  console.log(`Network: ${NETWORK}`);
  console.log(`Output: ${OUTPUT_DIR}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgv-bindings-'));
  const stagingDir = path.join(workDir, 'out');
  try {
    execSync(
      `stellar contract bindings typescript ` +
        `--contract-id ${contractId} ` +
        `--rpc-url ${RPC_URL} ` +
        `--network-passphrase "${NETWORK_PASSPHRASE}" ` +
        `--output-dir "${stagingDir}"`,
      { stdio: 'inherit' },
    );
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.cpSync(stagingDir, OUTPUT_DIR, { recursive: true, force: true });
    fs.writeFileSync(STAMP_PATH, renderStamp(contractId));
    console.log('Bindings generated successfully!');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  if (error instanceof BindingsError) {
    console.error(error.message);
  } else {
    console.error('Failed to generate bindings:', error);
    console.error('frontend/src/generated/ was left unchanged. Fix the error above and rerun.');
  }
  process.exit(1);
}
