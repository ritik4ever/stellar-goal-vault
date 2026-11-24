import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { TESTNET_PASSPHRASE } from './fixtures/freighter-bridge';

const TESTNET_RPC_URL = 'https://soroban-testnet.stellar.org:443';

/** Validate before Playwright starts either server or a fixture can write state. */
export function createE2EServerEnv(root: string, inherited: NodeJS.ProcessEnv = process.env) {
  const readEnvFile = (file: string): Record<string, string> => {
    try {
      return parse(readFileSync(join(root, file)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`E2E setup: ${file} must be a readable file.`);
      }
      return {};
    }
  };
  const fileEnv = readEnvFile('backend/.env');
  // Vite's default dev mode loads these in increasing priority order.
  const frontendEnv = Object.assign(
    {},
    ...['.env', '.env.local', '.env.development', '.env.development.local'].map((name) =>
      readEnvFile(`frontend/${name}`),
    ),
  );
  // Match dotenv's precedence without mutating the test runner's environment.
  const env = { ...fileEnv, ...inherited };
  const fail = (name: string, expected: string): never => {
    // Do not echo environment values: a URL or path may contain credentials.
    throw new Error(`E2E setup: ${name} ${expected}`);
  };
  const apiUrl = inherited.VITE_API_URL ?? frontendEnv.VITE_API_URL;
  if (apiUrl !== undefined && apiUrl !== '/api') {
    fail('VITE_API_URL', 'must be /api so browser writes use the local test backend.');
  }
  if (env.NODE_ENV !== undefined && !['test', 'development'].includes(env.NODE_ENV)) {
    fail('NODE_ENV', 'must be test or development.');
  }
  if (env.DB_PATH !== undefined && env.DB_PATH !== ':memory:') {
    fail('DB_PATH', 'must be :memory:; file databases are not allowed in E2E.');
  }
  if (env.PORT !== undefined && env.PORT !== '3001') {
    fail('PORT', 'must be 3001 to match the frontend proxy and health check.');
  }
  const passphrase = env.SOROBAN_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE;
  if (passphrase !== TESTNET_PASSPHRASE) {
    fail('SOROBAN_NETWORK_PASSPHRASE', 'must select Stellar testnet.');
  }
  const rpcUrl = env.SOROBAN_RPC_URL ?? TESTNET_RPC_URL;
  const rpc = (() => {
    try {
      return new URL(rpcUrl);
    } catch {
      return fail('SOROBAN_RPC_URL', 'must be an absolute HTTP(S) testnet or loopback URL.');
    }
  })();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname);
  const testnet = rpc.hostname === 'soroban-testnet.stellar.org' && rpc.protocol === 'https:';
  if (
    !['http:', 'https:'].includes(rpc.protocol) ||
    (!loopback && !testnet) ||
    rpc.username ||
    rpc.password ||
    rpc.hash
  ) {
    fail('SOROBAN_RPC_URL', 'must be a credential-free testnet or loopback HTTP(S) URL.');
  }
  return {
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    PORT: '3001',
    SOROBAN_NETWORK_PASSPHRASE: passphrase,
    SOROBAN_RPC_URL: rpcUrl,
    VITE_API_URL: '/api',
  };
}
