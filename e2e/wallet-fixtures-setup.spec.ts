import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createE2EServerEnv } from './setup';
import {
  installFreighterBridge,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  type FreighterBridgeOptions,
} from './fixtures/freighter-bridge';
import { mockFreighter, TEST_CONTRIBUTORS } from './fixtures/wallets';

test.describe('E2E server preflight', () => {
  let root: string;
  test.beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sgv-e2e-setup-'));
    mkdirSync(join(root, 'backend'));
    mkdirSync(join(root, 'frontend'));
  });
  test.afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('defaults to an isolated memory database and explicit testnet environment', () => {
    expect(createE2EServerEnv(root, {})).toEqual({
      NODE_ENV: 'test',
      DB_PATH: ':memory:',
      PORT: '3001',
      SOROBAN_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
      SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org:443',
      VITE_API_URL: '/api',
    });
  });

  for (const [name, value] of [
    ['NODE_ENV', 'production'],
    ['NODE_ENV', ''],
    ['PORT', '8080'],
    ['SOROBAN_NETWORK_PASSPHRASE', MAINNET_PASSPHRASE],
    ['SOROBAN_NETWORK_PASSPHRASE', ''],
    ['SOROBAN_RPC_URL', 'not-a-url'],
    ['SOROBAN_RPC_URL', 'file:///tmp/rpc'],
    ['SOROBAN_RPC_URL', 'https://soroban.stellar.org'],
    ['SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org.evil.invalid'],
    ['SOROBAN_RPC_URL', 'http://soroban-testnet.stellar.org'],
    ['SOROBAN_RPC_URL', 'https://secret@localhost/rpc'],
    ['SOROBAN_RPC_URL', 'https://localhost/rpc#fragment'],
    ['DB_PATH', ''],
    ['VITE_API_URL', 'https://external.invalid/api'],
    ['VITE_API_URL', '//external.invalid/api'],
  ]) {
    test(`rejects ${name}=${value} before server startup`, () => {
      expect(() => createE2EServerEnv(root, { [name]: value })).toThrow(`E2E setup: ${name}`);
    });
  }

  test('rejects a file database without changing its contents', () => {
    const database = join(root, 'campaigns.db');
    writeFileSync(database, 'existing development database');
    expect(() => createE2EServerEnv(root, { DB_PATH: database })).toThrow('DB_PATH');
    expect(readFileSync(database, 'utf8')).toBe('existing development database');
  });

  test('validates backend/.env with dotenv precedence and does not mutate inherited env', () => {
    writeFileSync(join(root, 'backend', '.env'), 'DB_PATH=./data/campaigns.db\n');
    expect(() => createE2EServerEnv(root, {})).toThrow('DB_PATH');
    const inherited = { DB_PATH: ':memory:' };
    expect(createE2EServerEnv(root, inherited).DB_PATH).toBe(':memory:');
    expect(inherited).toEqual({ DB_PATH: ':memory:' });
    expect(readFileSync(join(root, 'backend', '.env'), 'utf8')).toContain('./data/campaigns.db');
  });

  test('fails clearly when backend/.env is not a readable file', () => {
    mkdirSync(join(root, 'backend', '.env'));
    expect(() => createE2EServerEnv(root, {})).toThrow('backend/.env must be a readable file');
  });

  for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    test(`validates frontend/${name} before browser API writes`, () => {
      writeFileSync(join(root, 'frontend', name), 'VITE_API_URL=https://external.invalid/api\n');
      expect(() => createE2EServerEnv(root, {})).toThrow('VITE_API_URL');
      expect(createE2EServerEnv(root, { VITE_API_URL: '/api' }).VITE_API_URL).toBe('/api');
    });
  }

  for (const rpc of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000']) {
    test(`allows an explicit loopback test RPC: ${rpc}`, () => {
      expect(createE2EServerEnv(root, { SOROBAN_RPC_URL: rpc }).SOROBAN_RPC_URL).toBe(rpc);
    });
  }
});

test.describe('Wallet mock setup validation', () => {
  for (const options of [
    { publicKey: '' },
    { publicKey: 'S' + 'A'.repeat(55) },
    { sign: 'aprove' },
    { access: 'allow' },
    { networkPassphrase: '' },
    { sorobanRpcUrl: '' },
    { sorobanRpcUrl: '/rpc' },
    { sorobanRpcUrl: 'file:///tmp/rpc' },
    { sorobanRpcUrl: 'https://secret@localhost/rpc' },
  ]) {
    test(`rejects invalid options before touching the page: ${JSON.stringify(options)}`, async () => {
      let pageCalls = 0;
      const page = {
        addInitScript: async () => {
          pageCalls++;
        },
        evaluate: async () => {
          pageCalls++;
        },
      } as unknown as Page;
      await expect(
        installFreighterBridge(page, {
          publicKey: TEST_CONTRIBUTORS.dave,
          ...options,
        } as FreighterBridgeOptions),
      ).rejects.toThrow('Wallet fixture setup:');
      expect(pageCalls).toBe(0);
    });
  }

  test('the public helper does not turn malformed null options into approval defaults', async () => {
    await expect(
      mockFreighter({} as Page, TEST_CONTRIBUTORS.dave, {
        sign: null,
      } as unknown as Parameters<typeof mockFreighter>[2]),
    ).rejects.toThrow('Wallet fixture setup: sign');
  });
});
