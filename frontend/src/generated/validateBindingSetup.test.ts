// @vitest-environment node
/**
 * Focused tests for validateBindingSetup — the pre-flight check that must
 * pass BEFORE the Stellar CLI runs, any signed transaction is built, or any
 * binding file is overwritten.
 *
 * All filesystem operations are injected, so no real files are read or
 * written, and no live funds or accounts are used.
 */

import { describe, expect, it } from 'vitest';
import {
  BindingSetupError,
  validateBindingSetup,
  type BindingSetupInputs,
  type BindingSetupFs,
} from '../../../scripts/lib/validate-binding-setup';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal valid inputs used as the base for all negative test variations. */
const VALID_INPUTS: BindingSetupInputs = {
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
  network: 'testnet',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  outputDir: '/tmp/test-generated',
};

/** No-op filesystem stub — output dir does not exist. */
const NO_DIR_FS: BindingSetupFs = {
  existsSync: () => false,
  statSync: () => ({ isDirectory: () => true }),
  probeWritable: () => undefined,
};

/** Filesystem stub — output dir exists and is writable. */
const EXISTING_WRITABLE_FS: BindingSetupFs = {
  existsSync: () => true,
  statSync: () => ({ isDirectory: () => true }),
  probeWritable: () => undefined,
};

function valid(overrides: Partial<BindingSetupInputs> = {}): BindingSetupInputs {
  return { ...VALID_INPUTS, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBindingSetup — invalid setup fails before any network or file operation', () => {
  describe('CONTRACT_ID', () => {
    it('throws when CONTRACT_ID is empty', () => {
      expect(() =>
        validateBindingSetup(valid({ contractId: '' }), NO_DIR_FS),
      ).toThrow(BindingSetupError);

      expect(() =>
        validateBindingSetup(valid({ contractId: '' }), NO_DIR_FS),
      ).toThrow(/CONTRACT_ID/);
    });

    it('throws when CONTRACT_ID is whitespace only', () => {
      expect(() =>
        validateBindingSetup(valid({ contractId: '   ' }), NO_DIR_FS),
      ).toThrow(BindingSetupError);
    });

    it('throws when CONTRACT_ID is the placeholder "YOUR_CONTRACT_ID"', () => {
      expect(() =>
        validateBindingSetup(valid({ contractId: 'YOUR_CONTRACT_ID' }), NO_DIR_FS),
      ).toThrow(/placeholder/i);
    });

    it('passes with a real contract ID', () => {
      expect(() => validateBindingSetup(valid(), NO_DIR_FS)).not.toThrow();
    });
  });

  describe('NETWORK', () => {
    it('throws for an unrecognised network name', () => {
      expect(() =>
        validateBindingSetup(valid({ network: 'devnet' }), NO_DIR_FS),
      ).toThrow(/not a supported network/i);
    });

    it.each([
      ['testnet', 'Test SDF Network ; September 2015'],
      ['mainnet', 'Public Global Stellar Network ; September 2015'],
      ['futurenet', 'Test SDF Future Network ; October 2022'],
    ])('passes for %s', (network, networkPassphrase) => {
      expect(() =>
        validateBindingSetup(valid({ network, networkPassphrase }), NO_DIR_FS),
      ).not.toThrow();
    });
  });

  describe('RPC_URL', () => {
    it('throws when RPC_URL is empty', () => {
      expect(() =>
        validateBindingSetup(valid({ rpcUrl: '' }), NO_DIR_FS),
      ).toThrow(/RPC_URL/);
    });

    it('throws when RPC_URL does not start with https:// or http://', () => {
      expect(() =>
        validateBindingSetup(valid({ rpcUrl: 'soroban-testnet.stellar.org' }), NO_DIR_FS),
      ).toThrow(/does not start with https/i);
    });

    it('passes with an https:// URL', () => {
      expect(() => validateBindingSetup(valid(), NO_DIR_FS)).not.toThrow();
    });

    it('passes with an http:// URL (local dev)', () => {
      expect(() =>
        validateBindingSetup(valid({ rpcUrl: 'http://localhost:8000' }), NO_DIR_FS),
      ).not.toThrow();
    });
  });

  describe('NETWORK_PASSPHRASE', () => {
    it('throws when NETWORK_PASSPHRASE is empty', () => {
      expect(() =>
        validateBindingSetup(valid({ networkPassphrase: '' }), NO_DIR_FS),
      ).toThrow(/NETWORK_PASSPHRASE/);
    });

    it('throws when NETWORK_PASSPHRASE does not match the network', () => {
      expect(() =>
        validateBindingSetup(
          valid({
            network: 'testnet',
            networkPassphrase: 'Public Global Stellar Network ; September 2015',
          }),
          NO_DIR_FS,
        ),
      ).toThrow(/does not match the expected passphrase for/i);
    });

    it('throws for a completely wrong passphrase', () => {
      expect(() =>
        validateBindingSetup(valid({ networkPassphrase: 'wrong passphrase' }), NO_DIR_FS),
      ).toThrow(BindingSetupError);
    });
  });

  describe('OUTPUT_DIR', () => {
    it('passes when the output directory does not yet exist', () => {
      expect(() => validateBindingSetup(valid(), NO_DIR_FS)).not.toThrow();
    });

    it('throws when the output path exists but is a file, not a directory', () => {
      const fileFS: BindingSetupFs = {
        existsSync: () => true,
        statSync: () => ({ isDirectory: () => false }),
        probeWritable: () => undefined,
      };
      expect(() => validateBindingSetup(valid(), fileFS)).toThrow(/exists but is not a directory/i);
    });

    it('throws when the output directory is not writable', () => {
      const readonlyFS: BindingSetupFs = {
        ...EXISTING_WRITABLE_FS,
        probeWritable: () => {
          throw new BindingSetupError('OUTPUT_DIR', '"path" is not writable.');
        },
      };
      expect(() => validateBindingSetup(valid(), readonlyFS)).toThrow(/not writable/i);
    });

    it('passes when the output directory exists and is writable', () => {
      expect(() => validateBindingSetup(valid(), EXISTING_WRITABLE_FS)).not.toThrow();
    });
  });

  describe('ordering guarantee — validation fails BEFORE any filesystem probe', () => {
    it('never probes the output directory when CONTRACT_ID is invalid', () => {
      let probeCalled = false;
      const spyFS: BindingSetupFs = {
        ...EXISTING_WRITABLE_FS,
        probeWritable: () => {
          probeCalled = true;
        },
      };

      expect(() =>
        validateBindingSetup(valid({ contractId: '' }), spyFS),
      ).toThrow(BindingSetupError);

      expect(probeCalled).toBe(false);
    });

    it('never probes the output directory when NETWORK_PASSPHRASE mismatches', () => {
      let probeCalled = false;
      const spyFS: BindingSetupFs = {
        ...EXISTING_WRITABLE_FS,
        probeWritable: () => {
          probeCalled = true;
        },
      };

      expect(() =>
        validateBindingSetup(valid({ networkPassphrase: 'wrong passphrase' }), spyFS),
      ).toThrow(BindingSetupError);

      expect(probeCalled).toBe(false);
    });

    it('never probes the output directory when RPC_URL is invalid', () => {
      let probeCalled = false;
      const spyFS: BindingSetupFs = {
        ...EXISTING_WRITABLE_FS,
        probeWritable: () => {
          probeCalled = true;
        },
      };

      expect(() =>
        validateBindingSetup(valid({ rpcUrl: 'ftp://wrong-protocol' }), spyFS),
      ).toThrow(BindingSetupError);

      expect(probeCalled).toBe(false);
    });
  });

  describe('BindingSetupError shape', () => {
    it('carries the failing field name on the error object', () => {
      let err: BindingSetupError | undefined;
      try {
        validateBindingSetup(valid({ contractId: '' }), NO_DIR_FS);
      } catch (e) {
        err = e as BindingSetupError;
      }
      expect(err).toBeInstanceOf(BindingSetupError);
      expect(err?.field).toBe('CONTRACT_ID');
      expect(err?.name).toBe('BindingSetupError');
    });

    it('includes the field name in the error message', () => {
      let err: BindingSetupError | undefined;
      try {
        validateBindingSetup(valid({ network: 'invalid-net' }), NO_DIR_FS);
      } catch (e) {
        err = e as BindingSetupError;
      }
      expect(err?.message).toContain('NETWORK');
      expect(err?.field).toBe('NETWORK');
    });
  });
});
