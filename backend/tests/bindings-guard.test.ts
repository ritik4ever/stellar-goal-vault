import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BindingsError,
  checkBindingsDrift,
  isValidContractId,
  parseContractIdFile,
  renderStamp,
  resolveContractId,
} from '../../scripts/bindings-guard';

const DEPLOYED = `C${'A'.repeat(55)}`;
const OTHER = `C${'B'.repeat(55)}`;
const ID_FILE = `# populated after contract deployment\n\n${DEPLOYED}\n`;

describe('parseContractIdFile', () => {
  it('skips comments and blank lines', () => {
    expect(parseContractIdFile(ID_FILE)).toBe(DEPLOYED);
  });

  it('returns null for missing or comment-only files', () => {
    expect(parseContractIdFile(null)).toBeNull();
    expect(parseContractIdFile('# nothing yet\n\n')).toBeNull();
  });
});

describe('resolveContractId', () => {
  it('prefers CONTRACT_ID from the environment', () => {
    expect(resolveContractId(`  ${OTHER}  `, ID_FILE)).toEqual({ id: OTHER, source: 'env' });
  });

  it('falls back to contracts/contract_id.txt when CONTRACT_ID is empty', () => {
    expect(resolveContractId('', ID_FILE)).toEqual({ id: DEPLOYED, source: 'file' });
    expect(resolveContractId(undefined, ID_FILE)).toEqual({ id: DEPLOYED, source: 'file' });
  });

  it('stops with a recovery path when no ID is available', () => {
    expect(() => resolveContractId(undefined, '# populated after contract deployment\n')).toThrow(
      BindingsError,
    );
    expect(() => resolveContractId(undefined, null)).toThrow(/npm run gen:bindings/);
  });

  it('rejects the placeholder instead of using it silently', () => {
    expect(() => resolveContractId('YOUR_CONTRACT_ID', ID_FILE)).toThrow(/placeholder/);
  });

  it('rejects malformed IDs such as account addresses', () => {
    const account = `G${'A'.repeat(55)}`;
    expect(() => resolveContractId(account, null)).toThrow(/not a valid Soroban contract ID/);
  });

  it('accepts the contract ID committed in contracts/contract_id.txt', () => {
    const file = path.join(__dirname, '../../contracts/contract_id.txt');
    const { id } = resolveContractId(undefined, fs.readFileSync(file, 'utf8'));
    expect(isValidContractId(id)).toBe(true);
  });
});

describe('checkBindingsDrift', () => {
  it('reports unstamped bindings without failing', () => {
    expect(checkBindingsDrift(null, DEPLOYED).status).toBe('unstamped');
  });

  it('is in sync after a rerun against the same contract', () => {
    const first = renderStamp(DEPLOYED);
    const second = renderStamp(DEPLOYED);
    expect(second).toBe(first);
    expect(checkBindingsDrift(second, DEPLOYED).status).toBe('in-sync');
  });

  it('reports drift with both IDs and the recovery command', () => {
    const result = checkBindingsDrift(renderStamp(OTHER), DEPLOYED);
    expect(result.status).toBe('drift');
    expect(result.message).toContain(OTHER);
    expect(result.message).toContain(DEPLOYED);
    expect(result.message).toContain('npm run gen:bindings');
  });
});
