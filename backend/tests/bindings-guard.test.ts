import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  BindingsError,
  checkBindingsDrift,
  isValidContractId,
  isValidSecretKey,
  parseContractIdFile,
  renderStamp,
  resolveContractId,
  resolveDeploymentConfig,
  resolveNetworkConfig,
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  FUTURENET_PASSPHRASE,
  DEFAULT_TESTNET_RPC,
  DEFAULT_MAINNET_RPC,
  DEFAULT_FUTURENET_RPC,
} from '../../scripts/bindings-guard';
import {
  MAINNET_FIXTURE,
  MISSING_OR_CONFLICTING_DEPLOYMENT_FIXTURES,
  NETWORK_CONFIG_FIXTURES,
  TESTNET_FIXTURE,
} from '../../scripts/env-config-fixtures';

const DEPLOYED = `C${'A'.repeat(55)}`;
const OTHER = `C${'B'.repeat(55)}`;
const VALID_SECRET = `S${'A'.repeat(55)}`;
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

describe('resolveNetworkConfig', () => {
  it('resolves testnet defaults when no options are provided', () => {
    const config = resolveNetworkConfig();
    expect(config).toEqual({
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: DEFAULT_TESTNET_RPC,
    });
  });

  it('resolves mainnet defaults when network is mainnet', () => {
    const config = resolveNetworkConfig({ network: 'mainnet' });
    expect(config).toEqual({
      network: 'mainnet',
      networkPassphrase: MAINNET_PASSPHRASE,
      rpcUrl: DEFAULT_MAINNET_RPC,
    });
  });

  it('normalizes public alias to mainnet', () => {
    const config = resolveNetworkConfig({ network: 'public' });
    expect(config.network).toBe('mainnet');
    expect(config.networkPassphrase).toBe(MAINNET_PASSPHRASE);
  });

  it('resolves futurenet defaults when network is futurenet', () => {
    const config = resolveNetworkConfig({ network: 'futurenet' });
    expect(config).toEqual({
      network: 'futurenet',
      networkPassphrase: FUTURENET_PASSPHRASE,
      rpcUrl: DEFAULT_FUTURENET_RPC,
    });
  });

  it('rejects unsupported networks', () => {
    expect(() => resolveNetworkConfig({ network: 'unknown-network' })).toThrow(
      /Unsupported network "unknown-network"/,
    );
  });

  it('rejects testnet network with mainnet passphrase', () => {
    expect(() =>
      resolveNetworkConfig({
        network: 'testnet',
        networkPassphrase: MAINNET_PASSPHRASE,
      }),
    ).toThrow(/Network mismatch: testnet was selected but mainnet passphrase was provided/);
  });

  it('rejects testnet network with mainnet RPC URL', () => {
    expect(() =>
      resolveNetworkConfig({
        network: 'testnet',
        rpcUrl: 'https://soroban-mainnet.stellar.org:443',
      }),
    ).toThrow(/Network mismatch: testnet was selected but a mainnet RPC URL was provided/);
  });

  it('rejects mainnet network with testnet passphrase', () => {
    expect(() =>
      resolveNetworkConfig({
        network: 'mainnet',
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    ).toThrow(/Network mismatch: mainnet was selected but testnet passphrase was provided/);
  });

  it('rejects mainnet network with testnet RPC URL', () => {
    expect(() =>
      resolveNetworkConfig({
        network: 'mainnet',
        rpcUrl: 'https://soroban-testnet.stellar.org:443',
      }),
    ).toThrow(/Network mismatch: mainnet was selected but a testnet RPC URL was provided/);
  });

  it('rejects futurenet network with mainnet or testnet passphrase', () => {
    expect(() =>
      resolveNetworkConfig({
        network: 'futurenet',
        networkPassphrase: MAINNET_PASSPHRASE,
      }),
    ).toThrow(/Network mismatch: futurenet was selected but a conflicting passphrase was provided/);
  });

  it('preserves valid custom RPC URL and passphrase matching the network', () => {
    const customRpc = 'https://custom-testnet-rpc.example.com';
    const config = resolveNetworkConfig({
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: customRpc,
    });
    expect(config).toEqual({
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: customRpc,
    });
  });

  describe('Recovery Paths for Network Mismatches', () => {
    it('includes recovery message when unsupported network is provided', () => {
      expect(() => resolveNetworkConfig({ network: 'bad-net' })).toThrow(/Recovery: set NETWORK to one of/);
    });

    it('includes recovery message when testnet has mainnet passphrase', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'testnet', networkPassphrase: MAINNET_PASSPHRASE }),
      ).toThrow(/Recovery: set NETWORK=mainnet, or unset NETWORK_PASSPHRASE/);
    });

    it('includes recovery message when testnet has mainnet RPC URL', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'testnet', rpcUrl: 'https://soroban-mainnet.stellar.org' }),
      ).toThrow(/Recovery: set NETWORK=mainnet, or unset RPC_URL/);
    });

    it('includes recovery message when mainnet has testnet passphrase', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'mainnet', networkPassphrase: TESTNET_PASSPHRASE }),
      ).toThrow(/Recovery: set NETWORK=testnet, or unset NETWORK_PASSPHRASE/);
    });

    it('includes recovery message when mainnet has testnet RPC URL', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'mainnet', rpcUrl: 'https://soroban-testnet.stellar.org' }),
      ).toThrow(/Recovery: set NETWORK=testnet, or unset RPC_URL/);
    });

    it('rejects futurenet with conflicting RPC URL and provides recovery path', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'futurenet', rpcUrl: 'https://soroban-testnet.stellar.org' }),
      ).toThrow(/Recovery: unset RPC_URL to use the futurenet default/);
    });

    it('rejects standalone with public network passphrase and provides recovery path', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'standalone', networkPassphrase: MAINNET_PASSPHRASE }),
      ).toThrow(/Recovery: unset NETWORK_PASSPHRASE to use the standalone default/);
    });

    it('rejects local network with public RPC URL and provides recovery path', () => {
      expect(() =>
        resolveNetworkConfig({ network: 'local', rpcUrl: 'https://soroban-testnet.stellar.org' }),
      ).toThrow(/Recovery: unset RPC_URL to use the local default/);
    });
  });
});

describe('isValidSecretKey', () => {
  it('accepts valid 56-character base32 secret key', () => {
    expect(isValidSecretKey(VALID_SECRET)).toBe(true);
  });

  it('rejects invalid or placeholder secret keys', () => {
    expect(isValidSecretKey('')).toBe(false);
    expect(isValidSecretKey('S...')).toBe(false);
    expect(isValidSecretKey('YOUR_SECRET_KEY')).toBe(false);
    expect(isValidSecretKey(`G${'A'.repeat(55)}`)).toBe(false); // account public key
    expect(isValidSecretKey(`C${'A'.repeat(55)}`)).toBe(false); // contract strkey
    expect(isValidSecretKey('S123')).toBe(false); // too short
    expect(isValidSecretKey(`s${'A'.repeat(55)}`)).toBe(false); // lowercase
    expect(isValidSecretKey(`S${'0'.repeat(55)}`)).toBe(false); // invalid base32 (0 is not base32)
  });
});

describe('resolveDeploymentConfig', () => {
  it('resolves valid deployment configuration for testnet', () => {
    const config = resolveDeploymentConfig({
      secretKey: VALID_SECRET,
      network: 'testnet',
    });
    expect(config).toEqual({
      secretKey: VALID_SECRET,
      network: 'testnet',
      networkPassphrase: TESTNET_PASSPHRASE,
      rpcUrl: DEFAULT_TESTNET_RPC,
    });
  });

  it('resolves valid deployment configuration for mainnet', () => {
    const config = resolveDeploymentConfig({
      secretKey: VALID_SECRET,
      network: 'mainnet',
    });
    expect(config).toEqual({
      secretKey: VALID_SECRET,
      network: 'mainnet',
      networkPassphrase: MAINNET_PASSPHRASE,
      rpcUrl: DEFAULT_MAINNET_RPC,
    });
  });

  it('rejects missing or empty SECRET_KEY with actionable recovery path', () => {
    expect(() => resolveDeploymentConfig({ secretKey: '' })).toThrow(
      /Missing required deployment environment variable: SECRET_KEY/,
    );
    expect(() => resolveDeploymentConfig({ secretKey: '   ' })).toThrow(/Recovery: set SECRET_KEY/);
    expect(() => resolveDeploymentConfig({})).toThrow(/Recovery: set SECRET_KEY/);
  });

  it('rejects placeholder SECRET_KEY with recovery path', () => {
    expect(() => resolveDeploymentConfig({ secretKey: 'S...' })).toThrow(/Invalid SECRET_KEY format/);
    expect(() => resolveDeploymentConfig({ secretKey: 'YOUR_SECRET_KEY' })).toThrow(
      /Recovery: provide a valid 56-character base32 secret key/,
    );
  });

  it('rejects malformed SECRET_KEY with recovery path', () => {
    expect(() => resolveDeploymentConfig({ secretKey: `G${'A'.repeat(55)}` })).toThrow(
      /Invalid SECRET_KEY format/,
    );
    expect(() => resolveDeploymentConfig({ secretKey: 'S123' })).toThrow(
      /Recovery: provide a valid 56-character base32 secret key/,
    );
  });

  it('preserves startup error across repeated runs before any transaction is signed', () => {
    const badInput = {
      secretKey: VALID_SECRET,
      network: 'testnet',
      networkPassphrase: MAINNET_PASSPHRASE,
    };

    // First run fails with startup error
    expect(() => resolveDeploymentConfig(badInput)).toThrow(
      /Network mismatch: testnet was selected but mainnet passphrase was provided/,
    );

    // Repeated run preserves the identical startup error
    expect(() => resolveDeploymentConfig(badInput)).toThrow(
      /Network mismatch: testnet was selected but mainnet passphrase was provided/,
    );

    // Missing key repeatedly throws the identical error
    expect(() => resolveDeploymentConfig({})).toThrow(
      /Missing required deployment environment variable: SECRET_KEY/,
    );
    expect(() => resolveDeploymentConfig({})).toThrow(
      /Missing required deployment environment variable: SECRET_KEY/,
    );
  });
});

describe('Deterministic testnet vs mainnet & startup-error fixtures (no live funds)', () => {
  it('provides distinct, valid deterministic fixtures for testnet and mainnet', () => {
    expect(TESTNET_FIXTURE.networkPassphrase).not.toBe(MAINNET_FIXTURE.networkPassphrase);
    expect(TESTNET_FIXTURE.contractId).not.toBe(MAINNET_FIXTURE.contractId);
    expect(TESTNET_FIXTURE.rpcUrl).not.toBe(MAINNET_FIXTURE.rpcUrl);

    for (const profile of Object.values(NETWORK_CONFIG_FIXTURES)) {
      expect(isValidContractId(profile.contractId)).toBe(true);
      expect(isValidSecretKey(profile.secretKey)).toBe(true);
      expect(resolveContractId(profile.contractId, null)).toEqual({
        id: profile.contractId,
        source: 'env',
      });
      expect(
        resolveDeploymentConfig({
          secretKey: profile.secretKey,
          network: profile.network,
          networkPassphrase: profile.networkPassphrase,
          rpcUrl: profile.rpcUrl,
        }),
      ).toEqual({
        secretKey: profile.secretKey,
        network: profile.network,
        networkPassphrase: profile.networkPassphrase,
        rpcUrl: profile.rpcUrl,
      });
    }
  });

  it.each(MISSING_OR_CONFLICTING_DEPLOYMENT_FIXTURES)(
    'raises startup error before any signed transaction for $name',
    ({ input, expectedError, expectedRecovery }) => {
      const signTransaction = vi.fn();

      const runStartupThenSign = () => {
        const config = resolveDeploymentConfig(input);
        signTransaction(config);
      };

      expect(runStartupThenSign).toThrow(BindingsError);
      expect(runStartupThenSign).toThrow(expectedError);
      if (expectedRecovery) {
        expect(runStartupThenSign).toThrow(expectedRecovery);
      }
      expect(signTransaction).not.toHaveBeenCalled();
    },
  );
});
