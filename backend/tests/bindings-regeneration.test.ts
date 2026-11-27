import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STAMP_FILE,
  checkBindingsDrift,
  renderStamp,
  resolveContractId,
} from '../../scripts/bindings-guard';
import {
  BASELINE_CONTRACT_ABI,
  CONTRACT_ID_DIVERGENCE_FIXTURE,
  CONTRIBUTION_ARGS_ABI_CHANGE_FIXTURE,
  DEPLOYED_CONTRACT_ID,
  REFUND_ARGS_ABI_CHANGE_FIXTURE,
  detectAbiSignatureDrift,
} from '../../scripts/bindings-abi-fixtures';

const tempDirs: string[] = [];

function createCleanOutputDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgv-clean-bindings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('Soroban binding regeneration from a clean environment (SGV-2026-195)', () => {
  it('transitions from unstamped to in-sync and produces deterministic output on rerun', () => {
    const outputDir = createCleanOutputDir();
    const stampPath = path.join(outputDir, STAMP_FILE);

    // Clean environment: no .contract-id stamp exists yet.
    expect(fs.existsSync(stampPath)).toBe(false);
    const before = checkBindingsDrift(null, DEPLOYED_CONTRACT_ID);
    expect(before.status).toBe('unstamped');
    expect(before.message).toContain('npm run gen:bindings');

    // First regeneration into clean directory.
    const resolved = resolveContractId(DEPLOYED_CONTRACT_ID, null);
    const firstStamp = renderStamp(resolved.id);
    fs.writeFileSync(stampPath, firstStamp, 'utf8');

    const afterFirst = checkBindingsDrift(fs.readFileSync(stampPath, 'utf8'), DEPLOYED_CONTRACT_ID);
    expect(afterFirst.status).toBe('in-sync');

    // Second regeneration against the same contract ID produces byte-identical output.
    const secondStamp = renderStamp(resolved.id);
    fs.writeFileSync(stampPath, secondStamp, 'utf8');
    expect(fs.readFileSync(stampPath, 'utf8')).toBe(firstStamp);
    expect(checkBindingsDrift(fs.readFileSync(stampPath, 'utf8'), DEPLOYED_CONTRACT_ID).status).toBe(
      'in-sync',
    );
  });

  it('produces a CI-visible ABI drift result when generated types diverge from deployed contract ID', () => {
    const outputDir = createCleanOutputDir();
    const stampPath = path.join(outputDir, STAMP_FILE);

    fs.writeFileSync(stampPath, CONTRACT_ID_DIVERGENCE_FIXTURE.staleStampContent, 'utf8');

    const result = checkBindingsDrift(
      fs.readFileSync(stampPath, 'utf8'),
      CONTRACT_ID_DIVERGENCE_FIXTURE.deployedContractId,
    );

    expect(result.status).toBe('drift');
    expect(result.message).toContain('ABI drift');
    expect(result.message).toContain(CONTRACT_ID_DIVERGENCE_FIXTURE.generatedContractId);
    expect(result.message).toContain(CONTRACT_ID_DIVERGENCE_FIXTURE.deployedContractId);
    expect(result.message).toContain('npm run gen:bindings');
  });

  it('reports in-sync with exitCode 0 when generated signatures match contract ABI', () => {
    const result = detectAbiSignatureDrift(BASELINE_CONTRACT_ABI, BASELINE_CONTRACT_ABI);

    expect(result.status).toBe('in-sync');
    expect(result.exitCode).toBe(0);
    expect(result.driftedMethods).toEqual([]);
  });

  it.each([CONTRIBUTION_ARGS_ABI_CHANGE_FIXTURE, REFUND_ARGS_ABI_CHANGE_FIXTURE])(
    'produces a CI-visible ABI drift result with exitCode 1 for $name',
    (fixture) => {
      const result = detectAbiSignatureDrift(
        fixture.expectedContractAbi,
        fixture.staleGeneratedAbi,
      );

      expect(result.status).toBe('drift');
      expect(result.exitCode).toBe(1);
      expect(result.driftedMethods.map((d) => d.method)).toEqual(fixture.expectedDriftedMethods);
      expect(result.message).toContain('ABI drift detected');
      expect(result.message).toContain('npm run gen:bindings');
    },
  );

  it('verifies committed frontend/src/generated/index.ts exports GoalVaultContract', () => {
    const generatedIndexPath = path.join(__dirname, '../../frontend/src/generated/index.ts');
    const source = fs.readFileSync(generatedIndexPath, 'utf8');

    expect(source).toContain('export class GoalVaultContract');
    expect(source).toContain('async getContribution(');
    expect(source).toContain('async getCampaign(');
  });
});
