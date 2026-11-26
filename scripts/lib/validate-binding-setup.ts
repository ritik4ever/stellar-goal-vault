/**
 * Pure validation for Soroban binding regeneration setup.
 *
 * This module has NO filesystem, network, or environment side effects. All
 * environment values are passed in explicitly and all filesystem checks are
 * injected, which keeps the module unit-testable in any environment.
 *
 * The generator script (`scripts/gen-bindings.ts`) calls
 * {@link validateBindingSetup} BEFORE invoking the Stellar CLI, so an invalid
 * setup fails before a signed transaction can be built or a binding file can
 * be overwritten.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Known network passphrase constants (used for cross-validation)
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWN_PASSPHRASES: Record<string, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  futurenet: 'Test SDF Future Network ; October 2022',
};

/** Placeholder contract ID historically shipped as the default in this repo. */
export const PLACEHOLDER_CONTRACT_ID = 'YOUR_CONTRACT_ID';

/**
 * Represents a validation error that prevented binding generation.
 * Thrown before any file is written or any network call is made.
 */
export class BindingSetupError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`[gen:bindings] Invalid setup — ${field}: ${message}`);
    this.name = 'BindingSetupError';
  }
}

export interface BindingSetupInputs {
  contractId: string;
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  outputDir: string;
}

/** Injectable filesystem surface used to check the output directory. */
export interface BindingSetupFs {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean };
  probeWritable(dir: string): void;
}

/**
 * Validates environment and file-system inputs required to regenerate Soroban
 * bindings. This function never opens a socket, never submits a transaction,
 * and never writes a binding file — filesystem access is limited to the
 * injected `probeWritable` callback.
 *
 * Throws a {@link BindingSetupError} for the first invalid input found, so the
 * caller fails before any signed transaction or destructive write occurs.
 *
 * Validation order matters: contract, network, RPC URL and passphrase are all
 * checked before the output directory is probed, so a bad environment never
 * touches the filesystem at all.
 */
export function validateBindingSetup(inputs: BindingSetupInputs, fs: BindingSetupFs): void {
  const { contractId, network, rpcUrl, networkPassphrase, outputDir } = inputs;

  // 1. CONTRACT_ID must be present and non-placeholder
  if (!contractId || contractId.trim().length === 0) {
    throw new BindingSetupError(
      'CONTRACT_ID',
      'environment variable is missing or empty. ' +
        'Set CONTRACT_ID to the deployed Soroban contract ID before running gen:bindings.',
    );
  }
  if (contractId === PLACEHOLDER_CONTRACT_ID) {
    throw new BindingSetupError(
      'CONTRACT_ID',
      `is still set to the placeholder value "${PLACEHOLDER_CONTRACT_ID}". ` +
        'Deploy the contract and export the real contract ID.',
    );
  }

  // 2. NETWORK must be a recognised value
  const validNetworks = Object.keys(KNOWN_PASSPHRASES);
  if (!validNetworks.includes(network)) {
    throw new BindingSetupError(
      'NETWORK',
      `"${network}" is not a supported network. ` +
        `Expected one of: ${validNetworks.join(', ')}.`,
    );
  }

  // 3. RPC_URL must look like a URL
  if (!rpcUrl || rpcUrl.trim().length === 0) {
    throw new BindingSetupError(
      'RPC_URL',
      'is missing or empty. Provide a Soroban RPC endpoint URL.',
    );
  }
  if (!rpcUrl.startsWith('https://') && !rpcUrl.startsWith('http://')) {
    throw new BindingSetupError(
      'RPC_URL',
      `"${rpcUrl}" does not start with https:// or http://. Provide a valid URL.`,
    );
  }

  // 4. NETWORK_PASSPHRASE must be present
  if (!networkPassphrase || networkPassphrase.trim().length === 0) {
    throw new BindingSetupError(
      'NETWORK_PASSPHRASE',
      'is missing or empty. ' +
        'Set NETWORK_PASSPHRASE to the Stellar network passphrase that matches NETWORK.',
    );
  }

  // 5. NETWORK_PASSPHRASE must match the well-known value for the network
  const expectedPassphrase = KNOWN_PASSPHRASES[network];
  if (expectedPassphrase && networkPassphrase !== expectedPassphrase) {
    throw new BindingSetupError(
      'NETWORK_PASSPHRASE',
      `does not match the expected passphrase for "${network}". ` +
        `Expected: "${expectedPassphrase}", got: "${networkPassphrase}". ` +
        'A mismatched passphrase causes all transactions built from these bindings ' +
        'to be rejected by the network.',
    );
  }

  // 6. OUTPUT_DIR must either not exist or be a writable directory
  if (fs.existsSync(outputDir)) {
    const stat = fs.statSync(outputDir);
    if (!stat.isDirectory()) {
      throw new BindingSetupError(
        'OUTPUT_DIR',
        `"${outputDir}" exists but is not a directory. Remove the file and retry.`,
      );
    }
    // Write-access probe: confirms the directory is writable before the
    // Stellar CLI runs and potentially overwrites real binding files.
    fs.probeWritable(outputDir);
  }
}
