import type { Page } from '@playwright/test';
import {
  installFreighterBridge,
  TESTNET_PASSPHRASE,
  MAINNET_PASSPHRASE,
  type FreighterBridgeOptions,
} from './freighter-bridge';

export { TESTNET_PASSPHRASE, MAINNET_PASSPHRASE, readBridgeLog } from './freighter-bridge';
export type { FreighterBridgeOptions } from './freighter-bridge';
export {
  MockSorobanRpc,
  mockAppConfigSoroban,
  MOCK_CONTRACT_ID,
  MOCK_TX_HASH,
} from './mock-soroban-rpc';

/**
 * Deterministic but checksum-valid G... addresses (sha256(strkey-seed) →
 * ed25519 strkey). The Stellar SDK validates the strkey checksum the moment a
 * wallet address touches TransactionBuilder/Address, so synthetic
 * GAAAAA…-style addresses crash the signing flow before any network call.
 */
export const TEST_CREATORS = {
  alice: 'GC77PO6WRN6RPJWYMEUAPRXIAT2BKJIYCZOQGGTFQUQ5SXR6FXU27TPE',
  bob: 'GB63TL3BTBIUA2BCX6UUAB4MMRGM5DNP6N7HWAIITTY4J5WXWLKRJBGG',
  charlie: 'GBRFP2HZE4KFTFF6MQFK6BLQO55XP6LDKB475MGJRQU3C4TVD345ZIV4',
} as const;

export const TEST_CONTRIBUTORS = {
  dave: 'GB4X4OB32Q6HNMLIZ6XUO57P3HNFHLR4E5LDK5XI22NJILOSLQDU2IN7',
  eve: 'GDELE6ZJ5MP2L3SZM3WBPCIHYYGITFLA224WZPA7VF4KNZDGGHAYDLIG',
  frank: 'GASB3UYWZKSUDV6P3SEQSSBAGAB6Y37EARKUT7VHBWNG5P2YODQKDKXY',
} as const;

export type MockFreighterOptions = Partial<Omit<FreighterBridgeOptions, 'publicKey'>>;

/**
 * Emulates the Freighter extension for a page.
 *
 * The old helper only set the `window.freighter` sentinel, which satisfies
 * `isConnected()` but left `requestAccess()` and `signTransaction()` hanging on
 * the real `window.postMessage` bridge. `installFreighterBridge` answers the
 * bridge protocol itself, so the whole connect/sign flow runs.
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
    sign: options.sign ?? 'sign',
  });
}
