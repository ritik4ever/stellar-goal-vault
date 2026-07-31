import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEnv } from './validateEnv';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    CONTRACT_ID: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('validateEnv', () => {
  it('accepts development configuration without metrics credentials', () => {
    process.env.NODE_ENV = 'development';
    const exit = vi.spyOn(process, 'exit');

    validateEnv();

    expect(exit).not.toHaveBeenCalled();
  });

  it('accepts production configuration with metrics credentials', () => {
    process.env.NODE_ENV = 'production';
    process.env.METRICS_USERNAME = 'prometheus';
    process.env.METRICS_PASSWORD = 'secret';
    const exit = vi.spyOn(process, 'exit');

    validateEnv();

    expect(exit).not.toHaveBeenCalled();
  });

  it('fails production startup when metrics credentials are missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.METRICS_USERNAME;
    delete process.env.METRICS_PASSWORD;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    expect(() => validateEnv()).toThrow('process.exit');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('METRICS_USERNAME is required in production'),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('METRICS_PASSWORD is required in production'),
    );
  });
});
