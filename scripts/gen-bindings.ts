/**
 * Generates TypeScript bindings from the deployed Soroban contract ABI.
 * Run with: npm run gen:bindings
 *
 * Uses `stellar contract bindings typescript` CLI to auto-generate
 * typed bindings and outputs them to frontend/src/generated/
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(__dirname, '../frontend/src/generated');
const CONTRACT_ID = process.env.CONTRACT_ID || 'YOUR_CONTRACT_ID';
const NETWORK = process.env.NETWORK || 'testnet';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log('Generating TypeScript bindings...');
console.log(`Contract ID: ${CONTRACT_ID}`);
console.log(`Network: ${NETWORK}`);
console.log(`Output: ${OUTPUT_DIR}`);

try {
  execSync(
    `stellar contract bindings typescript ` +
    `--contract-id ${CONTRACT_ID} ` +
    `--rpc-url ${RPC_URL} ` +
    `--network-passphrase "${NETWORK_PASSPHRASE}" ` +
    `--output-dir ${OUTPUT_DIR}`,
    { stdio: 'inherit' }
  );
  console.log('✅ Bindings generated successfully!');
} catch (error) {
  console.error('❌ Failed to generate bindings:', error);
  process.exit(1);
}
