/**
 * Pure helpers for scripts/gen-bindings.ts.
 * No side effects, so they can be unit-tested without the Stellar CLI or network.
 */

export const STAMP_FILE = '.contract-id';

export const PLACEHOLDER_CONTRACT_IDS = [
  'YOUR_CONTRACT_ID',
  'YOUR_DEPLOYED_CONTRACT_ID',
  'YOUR_MAINNET_CONTRACT_ID',
];

// Soroban contract strkey: "C" followed by 55 base32 characters.
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;

const RECOVERY =
  'Recovery: set CONTRACT_ID, or deploy with `npm run deploy:contract` so ' +
  'contracts/contract_id.txt holds the deployed ID, then rerun `npm run gen:bindings`.';

export class BindingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingsError';
  }
}

export function isValidContractId(id: string): boolean {
  return CONTRACT_ID_PATTERN.test(id);
}

/** First non-empty, non-comment line of an ID file, or null. */
export function parseContractIdFile(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith('#')) return line;
  }
  return null;
}

export interface ResolvedContractId {
  id: string;
  source: 'env' | 'file';
}

/**
 * CONTRACT_ID wins when set; otherwise contracts/contract_id.txt is used.
 * Stops with a clear message instead of silently using a placeholder.
 */
export function resolveContractId(
  envValue: string | undefined,
  fileText: string | null,
): ResolvedContractId {
  const fromEnv = envValue?.trim();
  const fromFile = parseContractIdFile(fileText);
  const resolved: ResolvedContractId | null = fromEnv
    ? { id: fromEnv, source: 'env' }
    : fromFile
      ? { id: fromFile, source: 'file' }
      : null;

  if (!resolved) {
    throw new BindingsError(`No deployed contract ID found.\n${RECOVERY}`);
  }
  if (PLACEHOLDER_CONTRACT_IDS.includes(resolved.id)) {
    throw new BindingsError(`Contract ID is still the placeholder "${resolved.id}".\n${RECOVERY}`);
  }
  if (!isValidContractId(resolved.id)) {
    throw new BindingsError(
      `"${resolved.id}" is not a valid Soroban contract ID (expected C + 55 base32 chars).\n${RECOVERY}`,
    );
  }
  return resolved;
}

/** Content of frontend/src/generated/.contract-id. Deterministic, so reruns cause no diff. */
export function renderStamp(contractId: string): string {
  return (
    '# Contract ID these bindings were generated from.\n' +
    '# Written by scripts/gen-bindings.ts, do not edit by hand.\n' +
    `${contractId}\n`
  );
}

export interface DriftResult {
  status: 'in-sync' | 'drift' | 'unstamped';
  message: string;
}

export function checkBindingsDrift(stampText: string | null, deployedId: string): DriftResult {
  const generatedFor = parseContractIdFile(stampText);
  if (!generatedFor) {
    return {
      status: 'unstamped',
      message:
        'Bindings in frontend/src/generated/ have no contract stamp yet. ' +
        'Run `npm run gen:bindings` once to record which contract they came from.',
    };
  }
  if (generatedFor !== deployedId) {
    return {
      status: 'drift',
      message:
        `ABI drift: bindings were generated for ${generatedFor} ` +
        `but the deployed contract is ${deployedId}.\n` +
        'Recovery: run `npm run gen:bindings` and commit frontend/src/generated/.',
    };
  }
  return { status: 'in-sync', message: `Bindings match deployed contract ${deployedId}.` };
}
