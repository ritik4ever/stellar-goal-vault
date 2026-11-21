import type { Page } from '@playwright/test';
import {
  installFreighterBridge,
  resetWalletMock,
  resolveDelayedSignatures,
  setWalletMockSignBehavior,
  readBridgeLog,
  readWalletMockSnapshot,
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  type FreighterBridgeOptions,
  type SignBehavior,
} from './freighter-bridge';

export {
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  readBridgeLog,
  readWalletMockSnapshot,
  resetWalletMock,
  resolveDelayedSignatures,
  setWalletMockSignBehavior,
} from './freighter-bridge';
export type {
  FreighterBridgeOptions,
  SignBehavior,
  AccessBehavior,
  WalletMockSnapshot,
  WalletMockStatus,
  BridgeEventLogEntry,
} from './freighter-bridge';

/**
 * Deterministic G… addresses for API and UI fixtures. These are synthetic and
 * never funded — wallet E2E mocks must not touch Friendbot, testnet balances,
 * or mainnet.
 */
export const TEST_CREATORS = {
  alice: `G${'A'.repeat(55)}`,
  bob: `G${'B'.repeat(55)}`,
  charlie: `G${'C'.repeat(55)}`,
} as const;

export const TEST_CONTRIBUTORS = {
  dave: `G${'D'.repeat(55)}`,
  eve: `G${'E'.repeat(55)}`,
  frank: `G${'F'.repeat(55)}`,
} as const;

export type MockFreighterOptions = Partial<Omit<FreighterBridgeOptions, 'publicKey'>>;

/**
 * Emulates Freighter for a Playwright page without a live extension or funds.
 *
 * Answers the `@stellar/freighter-api` v2 `postMessage` bridge (connect + sign).
 * Pass `sign: 'reject'` for an immediate stop, or `sign: 'delay'` to park the
 * signature until `resolveDelayedSignatures` / `resetWalletMock` recovers.
 *
 * Safe to call again on the same page: pending delayed signatures are cancelled
 * and behaviour is reset before the new options apply (rerun-safe).
 */
export async function mockFreighter(
  page: Page,
  publicKey: string,
  options: MockFreighterOptions = {},
): Promise<void> {
  await installFreighterBridge(page, {
    publicKey,
    networkPassphrase: options.networkPassphrase ?? TESTNET_PASSPHRASE,
    sorobanRpcUrl: options.sorobanRpcUrl,
    access: options.access ?? 'grant',
    sign: options.sign ?? 'approve',
    signRejectMessage: options.signRejectMessage,
  });
}

/**
 * Convenience recovery: cancel any delayed signature, restore approve mode,
 * and leave the mock ready for another attempt on the same page.
 */
export async function recoverWalletMock(
  page: Page,
  nextSign: SignBehavior = 'approve',
): Promise<void> {
  await resetWalletMock(page);
  if (nextSign !== 'approve') {
    await setWalletMockSignBehavior(page, nextSign);
  }
}
