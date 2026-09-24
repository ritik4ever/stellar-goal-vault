import { describe, expect, it } from 'vitest';
import { validateEnv, envSchema } from './validateEnv';

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

  describe('Write Route Security Configuration', () => {
    it('fails in production when API_KEYS contains empty values', () => {
      const env = { ...validProdEnv, API_KEYS: 'key1,,key2' };
      expect(() => validateEnv(env)).toThrow(/API_KEYS contains empty or whitespace-only values/);
    });

    it('fails in production when API_KEYS contains only whitespace', () => {
      const env = { ...validProdEnv, API_KEYS: 'key1,   ,key2' };
      expect(() => validateEnv(env)).toThrow(/API_KEYS contains empty or whitespace-only values/);
    });

    it('rejects non-numeric WRITE_RATE_LIMIT_MAX_REQUESTS in production', () => {
      const env = { ...validProdEnv, WRITE_RATE_LIMIT_MAX_REQUESTS: 'invalid' };
      expect(() => validateEnv(env)).toThrow(/WRITE_RATE_LIMIT_MAX_REQUESTS must be a positive integer/);
    });

    it('rejects zero or negative WRITE_RATE_LIMIT_MAX_REQUESTS in production', () => {
      const env = { ...validProdEnv, WRITE_RATE_LIMIT_MAX_REQUESTS: '0' };
      expect(() => validateEnv(env)).toThrow(/WRITE_RATE_LIMIT_MAX_REQUESTS must be a positive integer/);
    });

    it('rejects WRITE_RATE_LIMIT_MAX_REQUESTS exceeding recommended maximum in production', () => {
      const env = { ...validProdEnv, WRITE_RATE_LIMIT_MAX_REQUESTS: '1001' };
      expect(() => validateEnv(env)).toThrow(/exceeds recommended maximum of 1000/);
    });

    it('allows valid WRITE_RATE_LIMIT_MAX_REQUESTS within recommended range in production', () => {
      const env = { ...validProdEnv, WRITE_RATE_LIMIT_MAX_REQUESTS: '100' };
      expect(() => validateEnv(env)).not.toThrow();
    });

    it('validates write rate limit format even in development when provided', () => {
      const devEnv: Record<string, string> = {
        NODE_ENV: 'development',
        WRITE_RATE_LIMIT_MAX_REQUESTS: 'invalid',
      };
      expect(() => validateEnv(devEnv)).toThrow(/WRITE_RATE_LIMIT_MAX_REQUESTS must be a non-negative integer/);
    });

    it('allows development mode without write rate limit when not provided', () => {
      const devEnv: Record<string, string> = {
        NODE_ENV: 'development',
      };
      expect(() => validateEnv(devEnv)).not.toThrow();
    });

    it('validates RATE_LIMIT_WRITE_LIMIT as alternative to WRITE_RATE_LIMIT_MAX_REQUESTS', () => {
      const env = { ...validProdEnv, RATE_LIMIT_WRITE_LIMIT: '50' };
      expect(() => validateEnv(env)).not.toThrow();
    });

    it('fails when RATE_LIMIT_WRITE_LIMIT is invalid in production', () => {
      const env = { ...validProdEnv, RATE_LIMIT_WRITE_LIMIT: '-5' };
      expect(() => validateEnv(env)).toThrow(/WRITE_RATE_LIMIT_MAX_REQUESTS must be a positive integer/);
    });
  });
});
