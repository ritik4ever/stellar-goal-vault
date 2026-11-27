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

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BindingsError,
  DEFAULT_BINDINGS_OUTPUT_DIR,
  STAMP_FILE,
  buildBindingsCommandArgs,
  checkBindingsDrift,
  renderStamp,
  resolveBindingRegenerationInputs,
} from './bindings-guard';

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, DEFAULT_BINDINGS_OUTPUT_DIR);
const CONTRACT_ID_FILE = path.join(ROOT, 'contracts/contract_id.txt');
const STAMP_PATH = path.join(OUTPUT_DIR, STAMP_FILE);

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function main(): void {
  const inputs = resolveBindingRegenerationInputs({
    contractId: process.env.CONTRACT_ID,
    contractIdFileText: readIfExists(CONTRACT_ID_FILE),
    network: process.env.NETWORK,
    networkPassphrase: process.env.NETWORK_PASSPHRASE,
    rpcUrl: process.env.RPC_URL,
    outputDir: OUTPUT_DIR,
    checkOnly: process.argv.includes('--check'),
  });

  if (inputs.checkOnly) {
    const result = checkBindingsDrift(readIfExists(STAMP_PATH), inputs.contractId);
    if (result.status === 'drift') {
      console.error(result.message);
      process.exit(1);
    }
    console.log(result.message);
    return;
  }

  const from = inputs.contractIdSource === 'env' ? 'CONTRACT_ID' : 'contracts/contract_id.txt';
  console.log('Generating TypeScript bindings...');
  console.log(`Contract ID: ${inputs.contractId} (from ${from})`);
  console.log(`Network: ${inputs.network}`);
  console.log(`Output: ${inputs.outputDir}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgv-bindings-'));
  const stagingDir = path.join(workDir, 'out');
  try {
    execFileSync('stellar', buildBindingsCommandArgs(inputs, stagingDir), {
      stdio: 'inherit',
    });
    fs.mkdirSync(inputs.outputDir, { recursive: true });
    fs.cpSync(stagingDir, inputs.outputDir, { recursive: true, force: true });
    fs.writeFileSync(STAMP_PATH, renderStamp(inputs.contractId));
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
