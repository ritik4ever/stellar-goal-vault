import { describe, expect, it, vi } from 'vitest';
import { validateEnv, envSchema } from './validateEnv';
import {
  MISSING_OR_CONFLICTING_BACKEND_ENV_FIXTURES,
  VALID_MAINNET_PROD_BACKEND_ENV,
  VALID_TESTNET_BACKEND_ENV,
} from '../../scripts/env-config-fixtures';

describe('Environment & Request Input Configuration Validation', () => {
  const validDevEnv: Record<string, string> = {
    NODE_ENV: 'test',
    CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org:443',
    SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  };

  const validProdEnv: Record<string, string> = {
    NODE_ENV: 'production',
    CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org:443',
    SOROBAN_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
    ALLOWED_ORIGINS: 'https://app.example.com',
    API_KEYS: 'secret-key-1,secret-key-2',
    LOG_LEVEL: 'info',
    WEBHOOK_URL: 'https://example.com/webhook',
    WEBHOOK_SECRET: 'webhook-secret-123',
    MAX_BODY_SIZE: '16kb',
    RATE_LIMIT_WINDOW_MS: '60000',
    RATE_LIMIT_MAX_REQUESTS: '120',
  };

  it('passes validation for valid non-production configuration with defaults', () => {
    expect(() => validateEnv(validDevEnv)).not.toThrow();
  });

  it('passes validation for fully configured production environment', () => {
    expect(() => validateEnv(validProdEnv)).not.toThrow();
  });

  it('fails in production when API_KEYS is missing', () => {
    const env = { ...validProdEnv, API_KEYS: '' };
    expect(() => validateEnv(env)).toThrow(/API_KEYS is required in production/);
  });

  it('fails in production when ALLOWED_ORIGINS uses wildcard *', () => {
    const env = { ...validProdEnv, ALLOWED_ORIGINS: '*' };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('fails in production when ALLOWED_ORIGINS is empty', () => {
    const env = { ...validProdEnv, ALLOWED_ORIGINS: '' };
    expect(() => validateEnv(env)).toThrow(/ALLOWED_ORIGINS is required in production/);
  });

  it('fails in production when SOROBAN_RPC_URL is missing', () => {
    const env = { ...validProdEnv, SOROBAN_RPC_URL: '' };
    expect(() => validateEnv(env)).toThrow(/SOROBAN_RPC_URL is required in production/);
  });

  it('fails in production when SOROBAN_NETWORK_PASSPHRASE is missing', () => {
    const env = { ...validProdEnv, SOROBAN_NETWORK_PASSPHRASE: '' };
    expect(() => validateEnv(env)).toThrow(/SOROBAN_NETWORK_PASSPHRASE is required in production/);
  });

  it('fails in production when CONTRACT_ID is missing', () => {
    const env = { ...validProdEnv, CONTRACT_ID: '' };
    expect(() => validateEnv(env)).toThrow(/CONTRACT_ID is required in production/);
  });

  it('rejects malformed MAX_BODY_SIZE string', () => {
    const env = { ...validDevEnv, MAX_BODY_SIZE: 'invalid-size' };
    expect(() => validateEnv(env)).toThrow(/MAX_BODY_SIZE must be a valid size string/);
  });

  it('rejects negative numbers for rate limit variables', () => {
    const env = { ...validDevEnv, RATE_LIMIT_WINDOW_MS: '-60000' };
    expect(() => validateEnv(env)).toThrow(/RATE_LIMIT_WINDOW_MS must be a non-negative integer/);
  });

  it('parses valid byte size strings for MAX_BODY_SIZE in schema', () => {
    const parsed = envSchema.safeParse({ ...validDevEnv, MAX_BODY_SIZE: '1mb' });
    expect(parsed.success).toBe(true);
  });

  it('fails in production and names LOG_LEVEL when debug logging is enabled', () => {
    let message = '';
    try {
      validateEnv({ ...validProdEnv, LOG_LEVEL: 'debug' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/not allowed in production/);
  });

  it('fails in production and names WEBHOOK_SECRET when WEBHOOK_URL has no secret', () => {
    const env = { ...validProdEnv, WEBHOOK_SECRET: '' };
    expect(() => validateEnv(env)).toThrow(
      /WEBHOOK_SECRET is required in production when WEBHOOK_URL is configured/,
    );
  });

  it('fails in production and names SOROBAN_RPC_URL when it is not HTTPS', () => {
    const env = { ...validProdEnv, SOROBAN_RPC_URL: 'http://soroban.example:8000' };
    expect(() => validateEnv(env)).toThrow(/SOROBAN_RPC_URL must use HTTPS in production/);
  });

  it('rejects non-documented NODE_ENV values to prevent silent hardening bypass', () => {
    for (const bad of ['prod', 'Production', 'staging', ' ']) {
      expect(() => validateEnv({ ...validProdEnv, NODE_ENV: bad })).toThrow(
        /NODE_ENV must be one of/,
      );
    }
  });

  it('allows documented development/test overrides that production rejects', () => {
    const devEnv: Record<string, string> = {
      NODE_ENV: 'test',
      CONTRACT_ID: '',
      SOROBAN_RPC_URL: 'http://localhost:8000',
      SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      ALLOWED_ORIGINS: '*',
      LOG_LEVEL: 'debug',
      WEBHOOK_URL: 'https://example.com/webhook',
    };
    expect(() => validateEnv(devEnv)).not.toThrow();
  });

  describe('Contract ID & Network Alignment Validation', () => {
    it('rejects placeholder CONTRACT_ID in any environment', () => {
      const placeholders = [
        'YOUR_CONTRACT_ID',
        'YOUR_DEPLOYED_CONTRACT_ID',
        'YOUR_MAINNET_CONTRACT_ID',
      ];
      for (const placeholder of placeholders) {
        expect(() => validateEnv({ ...validDevEnv, CONTRACT_ID: placeholder })).toThrow(
          /CONTRACT_ID cannot be placeholder/,
        );
      }
    });

    it('rejects malformed CONTRACT_ID format', () => {
      const badIds = [
        'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN', // Stellar account, not contract
        'C123', // too short
        'c' + 'A'.repeat(55), // lowercase c
        'C' + '0'.repeat(55), // invalid base32 (0 is not in base32 alphabet)
      ];
      for (const bad of badIds) {
        expect(() => validateEnv({ ...validDevEnv, CONTRACT_ID: bad })).toThrow(
          /is not a valid Soroban contract ID/,
        );
      }
    });

    it('rejects network mismatch when testnet passphrase is used with mainnet RPC URL', () => {
      const mismatched = {
        ...validDevEnv,
        SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
        SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org:443',
      };
      expect(() => validateEnv(mismatched)).toThrow(
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for testnet, but SOROBAN_RPC_URL points to mainnet/,
      );
    });

    it('rejects network mismatch when mainnet passphrase is used with testnet RPC URL', () => {
      const mismatched = {
        ...validDevEnv,
        SOROBAN_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org:443',
      };
      expect(() => validateEnv(mismatched)).toThrow(
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for mainnet, but SOROBAN_RPC_URL points to testnet/,
      );
    });

    it('rejects mainnet SOROBAN_RPC_URL when SOROBAN_NETWORK_PASSPHRASE is missing with recovery path', () => {
      const missingPassphrase = {
        ...validDevEnv,
        SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org:443',
        SOROBAN_NETWORK_PASSPHRASE: '',
      };
      expect(() => validateEnv(missingPassphrase)).toThrow(
        /Missing or conflicting network environment variable: SOROBAN_RPC_URL points to mainnet/,
      );
      expect(() => validateEnv(missingPassphrase)).toThrow(/Recovery: set SOROBAN_NETWORK_PASSPHRASE/);
    });

    it('rejects mainnet SOROBAN_NETWORK_PASSPHRASE when SOROBAN_RPC_URL is missing with recovery path', () => {
      const missingRpc = {
        ...validDevEnv,
        SOROBAN_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
        SOROBAN_RPC_URL: '',
      };
      expect(() => validateEnv(missingRpc)).toThrow(
        /Missing or conflicting network environment variable: SOROBAN_NETWORK_PASSPHRASE is configured for mainnet/,
      );
      expect(() => validateEnv(missingRpc)).toThrow(/Recovery: set SOROBAN_RPC_URL/);
    });

    it('preserves startup error across repeated runs of validateEnv', () => {
      const mismatched = {
        ...validDevEnv,
        SOROBAN_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
        SOROBAN_RPC_URL: 'https://soroban-mainnet.stellar.org:443',
      };

      // Run 1 throws startup error
      expect(() => validateEnv(mismatched)).toThrow(
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for testnet, but SOROBAN_RPC_URL points to mainnet/,
      );

      // Repeated run 2 preserves the exact same startup error
      expect(() => validateEnv(mismatched)).toThrow(
        /Network mismatch: SOROBAN_NETWORK_PASSPHRASE is configured for testnet, but SOROBAN_RPC_URL points to mainnet/,
      );
    });
  });

  describe('Deterministic testnet vs mainnet & startup-error fixtures (no live funds)', () => {
    it('accepts deterministic testnet and mainnet production backend fixtures', () => {
      expect(() => validateEnv(VALID_TESTNET_BACKEND_ENV)).not.toThrow();
      expect(() => validateEnv(VALID_MAINNET_PROD_BACKEND_ENV)).not.toThrow();
    });

    it.each(MISSING_OR_CONFLICTING_BACKEND_ENV_FIXTURES)(
      'fails startup validation before any signed transaction for $name',
      ({ env, expectedError }) => {
        const signAndSubmitTransaction = vi.fn();

        const bootAndSign = () => {
          validateEnv(env);
          signAndSubmitTransaction();
        };

        expect(bootAndSign).toThrow(expectedError);
        expect(signAndSubmitTransaction).not.toHaveBeenCalled();
      },
    );
  });
});
