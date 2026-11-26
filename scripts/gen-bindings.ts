/**
 * Generates TypeScript bindings from the deployed Soroban contract ABI.
 * Run with: npm run gen:bindings
 *
 * Uses `stellar contract bindings typescript` CLI to auto-generate
 * typed bindings and outputs them to frontend/src/generated/
 *
 * Pre-flight validation runs before any network call or file write so that an
 * invalid environment fails fast — never after a signed transaction or a
 * destructive database write.
 *
 * Required environment variables
 * ───────────────────────────────
 *  CONTRACT_ID          Soroban contract ID (must be a non-placeholder, non-empty string)
 *  NETWORK              testnet | mainnet | futurenet (default: testnet)
 *  RPC_URL              Soroban RPC endpoint URL (must start with https:// or http://)
 *  NETWORK_PASSPHRASE   Stellar network passphrase (required; must match NETWORK)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { validateBindingSetup, BindingSetupError } from './lib/validate-binding-setup';

export { validateBindingSetup, BindingSetupError };

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, '../frontend/src/generated');
const CONTRACT_ID = process.env.CONTRACT_ID ?? '';
const NETWORK = process.env.NETWORK ?? 'testnet';
const RPC_URL = process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('Validating binding regeneration setup…');

  // Pre-flight: all inputs must be valid BEFORE any file or network operation.
  // If this throws the process exits with a non-zero code and the Stellar CLI
  // is never invoked, so no signed transactions are built or submitted and no
  // binding files are overwritten with broken content.
  validateBindingSetup(
    { contractId: CONTRACT_ID, network: NETWORK, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE, outputDir: OUTPUT_DIR },
    {
      existsSync: fs.existsSync.bind(fs),
      statSync: (p: string) => fs.statSync(p),
      probeWritable: (dir: string) => {
        const probe = path.join(dir, '.gen-bindings-probe');
        try {
          fs.writeFileSync(probe, '');
          fs.unlinkSync(probe);
        } catch {
          throw new BindingSetupError(
            'OUTPUT_DIR',
            `"${dir}" is not writable. Check file permissions before regenerating bindings.`,
          );
        }
      },
    },
  );

  // Ensure output directory exists (safe to do after validation passes)
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('✅ Setup validation passed');
  console.log(`   Contract ID : ${CONTRACT_ID}`);
  console.log(`   Network     : ${NETWORK}`);
  console.log(`   RPC URL     : ${RPC_URL}`);
  console.log(`   Output dir  : ${OUTPUT_DIR}`);
  console.log('Generating TypeScript bindings…');

  try {
    execSync(
      `stellar contract bindings typescript ` +
        `--contract-id ${CONTRACT_ID} ` +
        `--rpc-url ${RPC_URL} ` +
        `--network-passphrase "${NETWORK_PASSPHRASE}" ` +
        `--output-dir ${OUTPUT_DIR}`,
      { stdio: 'inherit' },
    );
    console.log('✅ Bindings generated successfully!');
  } catch (error) {
    console.error('❌ Failed to generate bindings:', error);
    process.exit(1);
  }
}

// Guard: only run main() when this file is the direct entry point.
// This allows the exported `validateBindingSetup` and `BindingSetupError` to
// be imported by tests without triggering the full generation flow.
if (require.main === module) {
  main();
}
