/**
 * Deterministic, non-live fixtures for Soroban binding regeneration and ABI
 * drift verification (SGV-2026-195).
 *
 * All contract IDs and account addresses are synthetic base32 strkeys and must
 * never be funded or used against live networks.
 */

import { renderStamp } from './bindings-guard';

export interface AbiArgumentSpec {
  readonly name: string;
  readonly type: string;
}

export interface AbiMethodSignature {
  readonly name: string;
  readonly args: readonly AbiArgumentSpec[];
  readonly returns: string;
}

export interface AbiSignatureDriftDetail {
  readonly method: string;
  readonly reason: string;
}

export interface AbiSignatureDriftResult {
  readonly status: 'in-sync' | 'drift';
  readonly exitCode: 0 | 1;
  readonly driftedMethods: readonly AbiSignatureDriftDetail[];
  readonly message: string;
}

function formatMethodSignature(sig: AbiMethodSignature): string {
  const args = sig.args.map((a) => `${a.name}: ${a.type}`).join(', ');
  return `${sig.name}(${args}) -> ${sig.returns}`;
}

/**
 * Compares the expected Soroban contract ABI method signatures against the
 * generated TypeScript binding signatures. Produces a deterministic, CI-visible
 * drift result with exitCode 1 when any method is missing or its arguments /
 * return type diverge.
 */
export function detectAbiSignatureDrift(
  expectedAbi: readonly AbiMethodSignature[],
  generatedAbi: readonly AbiMethodSignature[],
): AbiSignatureDriftResult {
  const generatedByName = new Map(generatedAbi.map((m) => [m.name, m]));
  const driftedMethods: AbiSignatureDriftDetail[] = [];

  for (const expected of expectedAbi) {
    const actual = generatedByName.get(expected.name);
    if (!actual) {
      driftedMethods.push({
        method: expected.name,
        reason: `missing from generated bindings (expected ${formatMethodSignature(expected)})`,
      });
      continue;
    }

    const expectedFormatted = formatMethodSignature(expected);
    const actualFormatted = formatMethodSignature(actual);
    if (expectedFormatted !== actualFormatted) {
      driftedMethods.push({
        method: expected.name,
        reason: `expected ${expectedFormatted}, generated ${actualFormatted}`,
      });
    }
  }

  if (driftedMethods.length > 0) {
    const details = driftedMethods.map((d) => `- ${d.method}: ${d.reason}`).join('\n');
    return {
      status: 'drift',
      exitCode: 1,
      driftedMethods,
      message:
        `ABI drift detected in generated bindings:\n${details}\n` +
        'Recovery: run `npm run gen:bindings` and commit frontend/src/generated/.',
    };
  }

  return {
    status: 'in-sync',
    exitCode: 0,
    driftedMethods: [],
    message: 'Generated binding signatures match contract ABI.',
  };
}

/** Synthetic non-live Soroban contract IDs (C + 55 base32 chars). */
export const DEPLOYED_CONTRACT_ID = `C${'D'.repeat(55)}`;
export const STALE_CONTRACT_ID = `C${'S'.repeat(55)}`;

/**
 * Baseline Soroban contract ABI signatures covering campaign, contribution,
 * and refund flows.
 */
export const BASELINE_CONTRACT_ABI: readonly AbiMethodSignature[] = Object.freeze([
  {
    name: 'get_campaign_count',
    args: [],
    returns: 'u64',
  },
  {
    name: 'get_campaign',
    args: [{ name: 'campaign_id', type: 'u64' }],
    returns: 'Campaign',
  },
  {
    name: 'contribute',
    args: [
      { name: 'campaign_id', type: 'u64' },
      { name: 'contributor', type: 'Address' },
      { name: 'token', type: 'Address' },
      { name: 'amount', type: 'i128' },
    ],
    returns: 'void',
  },
  {
    name: 'get_contribution',
    args: [
      { name: 'campaign_id', type: 'u64' },
      { name: 'contributor', type: 'Address' },
      { name: 'token', type: 'Address' },
    ],
    returns: 'i128',
  },
  {
    name: 'refund',
    args: [
      { name: 'campaign_id', type: 'u64' },
      { name: 'contributor', type: 'Address' },
    ],
    returns: 'i128',
  },
]);

export interface AbiChangeFixture {
  readonly name: string;
  readonly expectedContractAbi: readonly AbiMethodSignature[];
  readonly staleGeneratedAbi: readonly AbiMethodSignature[];
  readonly expectedDriftedMethods: readonly string[];
}

/**
 * Deterministic fixture: ABI change to contribution arguments.
 * Simulates the Soroban contract adding a `memo: String` parameter to
 * `contribute` while `frontend/src/generated/` still has the previous bindings.
 */
export const CONTRIBUTION_ARGS_ABI_CHANGE_FIXTURE: AbiChangeFixture = Object.freeze({
  name: 'contribution arguments ABI change (added memo parameter)',
  expectedContractAbi: BASELINE_CONTRACT_ABI.map((method) =>
    method.name === 'contribute'
      ? {
          ...method,
          args: [...method.args, { name: 'memo', type: 'String' }],
        }
      : method,
  ),
  staleGeneratedAbi: BASELINE_CONTRACT_ABI,
  expectedDriftedMethods: ['contribute'],
});

/**
 * Deterministic fixture: ABI change to refund arguments.
 * Simulates the Soroban contract adding a `token: Address` parameter to
 * `refund` while `frontend/src/generated/` still has the previous bindings.
 */
export const REFUND_ARGS_ABI_CHANGE_FIXTURE: AbiChangeFixture = Object.freeze({
  name: 'refund arguments ABI change (added token parameter)',
  expectedContractAbi: BASELINE_CONTRACT_ABI.map((method) =>
    method.name === 'refund'
      ? {
          ...method,
          args: [...method.args, { name: 'token', type: 'Address' }],
        }
      : method,
  ),
  staleGeneratedAbi: BASELINE_CONTRACT_ABI,
  expectedDriftedMethods: ['refund'],
});

export interface ContractIdDivergenceFixture {
  readonly name: string;
  readonly deployedContractId: string;
  readonly generatedContractId: string;
  readonly staleStampContent: string;
}

/**
 * Deterministic fixture: generated bindings `.contract-id` stamp diverges
 * from the currently deployed contract ID.
 */
export const CONTRACT_ID_DIVERGENCE_FIXTURE: ContractIdDivergenceFixture = Object.freeze({
  name: 'generated bindings diverge from deployed contract ID',
  deployedContractId: DEPLOYED_CONTRACT_ID,
  generatedContractId: STALE_CONTRACT_ID,
  staleStampContent: renderStamp(STALE_CONTRACT_ID),
});
