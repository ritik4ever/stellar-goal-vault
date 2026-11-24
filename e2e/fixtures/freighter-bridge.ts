import type { Page } from '@playwright/test';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export type AccessBehavior = 'grant' | 'deny';
/** How the mock answers SUBMIT_TRANSACTION. */
export type SignBehavior = 'approve' | 'reject' | 'delay';

export interface FreighterBridgeOptions {
  /** Public key returned by requestAccess. */
  publicKey: string;
  /** Network the emulated extension reports via getNetworkDetails. */
  networkPassphrase?: string;
  /** Soroban RPC URL the emulated extension reports. */
  sorobanRpcUrl?: string;
  /** Behaviour of requestAccess (REQUEST_ACCESS / REQUEST_PUBLIC_KEY). */
  access?: AccessBehavior;
  /**
   * Behaviour of signTransaction (SUBMIT_TRANSACTION):
   * - `approve` — echo the XDR as signed (no live wallet / funds)
   * - `reject` — stop immediately with a user-declined error
   * - `delay` — hold the response until `resolveDelayedSignatures` or `resetWalletMock`
   */
  sign?: SignBehavior;
  /** Error message used when `sign: 'reject'`. */
  signRejectMessage?: string;
}

export interface BridgeEventLogEntry {
  type: string;
  at: number;
  /** Present when a delayed signature was parked or later resolved. */
  outcome?: 'parked' | 'approved' | 'rejected' | 'cancelled';
}

export type WalletMockStatus = 'idle' | 'awaiting_signature' | 'stopped';

export interface WalletMockSnapshot {
  status: WalletMockStatus;
  sign: SignBehavior;
  access: AccessBehavior;
  pendingCount: number;
  log: BridgeEventLogEntry[];
}

type PendingSignature = {
  messageId: string;
  transactionXdr: string;
  respond: (payload: Record<string, unknown>) => void;
};

type WalletMockController = {
  config: Required<
    Pick<FreighterBridgeOptions, 'publicKey' | 'networkPassphrase' | 'access' | 'sign'>
  > & {
    sorobanRpcUrl?: string;
    signRejectMessage: string;
  };
  status: WalletMockStatus;
  pending: PendingSignature[];
  log: BridgeEventLogEntry[];
  listenerAttached: boolean;
};

declare global {
  interface Window {
    __sgvWalletMock?: WalletMockController;
  }
}

const DEFAULT_REJECT_MESSAGE = 'User declined to sign the transaction.';

/**
 * Emulates the Freighter browser extension inside the page.
 *
 * `@stellar/freighter-api` v2 talks to the extension over `window.postMessage`:
 * requests use `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"` and the extension
 * replies with `source: "FREIGHTER_EXTERNAL_MSG_RESPONSE"` plus the matching
 * request id. The installed v2.0.0 build reads the id from `messagedId` (sic)
 * while sending `messageId`, so responses carry both spellings.
 *
 * Setting the `window.freighter` sentinel also satisfies `isConnected()`, which
 * short-circuits when the sentinel is present.
 *
 * Sign behaviour is mutable after install so a test can reject or delay a
 * signature, then recover without a reload — required for rerun-safe fixtures.
 */
export async function installFreighterBridge(
  page: Page,
  options: FreighterBridgeOptions,
): Promise<void> {
  // TypeScript types do not validate values loaded from env/JSON at runtime.
  // Check before registering any script or cancelling an existing signature.
  if (!/^G[A-Z2-7]{55}$/.test(options.publicKey)) {
    throw new Error('Wallet fixture setup: publicKey must be a synthetic G-address.');
  }
  if (options.sign !== undefined && !['approve', 'reject', 'delay'].includes(options.sign)) {
    throw new Error('Wallet fixture setup: sign must be approve, reject, or delay.');
  }
  if (options.access !== undefined && !['grant', 'deny'].includes(options.access)) {
    throw new Error('Wallet fixture setup: access must be grant or deny.');
  }
  if (
    options.networkPassphrase !== undefined &&
    ![TESTNET_PASSPHRASE, MAINNET_PASSPHRASE].includes(options.networkPassphrase)
  ) {
    throw new Error('Wallet fixture setup: networkPassphrase must select testnet or public network.');
  }
  if (options.sorobanRpcUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(options.sorobanRpcUrl);
    } catch {
      throw new Error('Wallet fixture setup: sorobanRpcUrl must be an absolute HTTP(S) URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error('Wallet fixture setup: sorobanRpcUrl must be a credential-free HTTP(S) URL.');
    }
  }
  const opts = {
    publicKey: options.publicKey,
    networkPassphrase: options.networkPassphrase ?? TESTNET_PASSPHRASE,
    sorobanRpcUrl: options.sorobanRpcUrl,
    access: options.access ?? ('grant' as AccessBehavior),
    sign: options.sign ?? ('approve' as SignBehavior),
    signRejectMessage: options.signRejectMessage ?? DEFAULT_REJECT_MESSAGE,
  };

  await page.addInitScript(
    ({ initial }) => {
      const g = window as Window & {
        freighter?: { __freighterEmulated: true };
        __sgvWalletMock?: WalletMockController;
      };

      // Sentinel consumed by isConnected() in @stellar/freighter-api v2.
      g.freighter = { __freighterEmulated: true };

      const existing = g.__sgvWalletMock;
      // Re-installing (or a second mockFreighter before navigation) must clear
      // any parked signatures so retries never inherit a hung delay.
      if (existing?.pending?.length) {
        for (const pending of existing.pending) {
          pending.respond({
            signedTransaction: '',
            error: 'Wallet mock reset: cancelled delayed signature.',
          });
        }
      }

      const controller: WalletMockController = {
        config: {
          publicKey: initial.publicKey,
          networkPassphrase: initial.networkPassphrase,
          sorobanRpcUrl: initial.sorobanRpcUrl,
          access: initial.access,
          sign: initial.sign,
          signRejectMessage: initial.signRejectMessage,
        },
        status: 'idle',
        pending: [],
        log: [],
        listenerAttached: existing?.listenerAttached ?? false,
      };
      g.__sgvWalletMock = controller;

      if (controller.listenerAttached) {
        return;
      }
      controller.listenerAttached = true;

      window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window) {
          return;
        }
        const mock = g.__sgvWalletMock;
        if (!mock) {
          return;
        }

        const data = event.data as {
          source?: string;
          messageId?: string;
          type?: string;
          transactionXdr?: string;
        } | null;
        if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
          return;
        }

        const respond = (payload: Record<string, unknown>): void => {
          // Double id key: v2.0.0 ships `messagedId` in the response matcher
          // while requests carry `messageId`; both are provided so any build
          // of the library resolves the round trip.
          // Use '*' so fixture pages on about:blank (opaque origin) still
          // receive responses; freighter-api matches on source + message id.
          window.postMessage(
            {
              ...payload,
              messageId: data.messageId,
              messagedId: data.messageId,
              source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
            },
            '*',
          );
        };

        const record = (
          type: string,
          outcome?: BridgeEventLogEntry['outcome'],
        ): void => {
          mock.log.push({ type, at: Date.now(), outcome });
        };

        switch (data.type) {
          case 'REQUEST_CONNECTION_STATUS':
            record('REQUEST_CONNECTION_STATUS');
            respond({ isConnected: true });
            return;

          case 'REQUEST_PUBLIC_KEY':
          case 'REQUEST_ACCESS':
            record(String(data.type));
            if (mock.config.access === 'deny') {
              mock.status = 'stopped';
              respond({ publicKey: '', error: 'The user declined access to their account.' });
              return;
            }
            mock.status = 'idle';
            respond({ publicKey: mock.config.publicKey, error: '' });
            return;

          case 'REQUEST_NETWORK_DETAILS': {
            record('REQUEST_NETWORK_DETAILS');
            const isTestnet =
              mock.config.networkPassphrase === 'Test SDF Network ; September 2015';
            respond({
              networkDetails: {
                network: isTestnet ? 'TESTNET' : 'PUBLIC',
                networkName: isTestnet ? 'Test Net' : 'Pub Net 2',
                networkUrl: '',
                networkPassphrase: mock.config.networkPassphrase,
                sorobanRpcUrl: mock.config.sorobanRpcUrl,
              },
              error: '',
            });
            return;
          }

          case 'SUBMIT_TRANSACTION': {
            const xdr = data.transactionXdr ?? '';
            if (mock.config.sign === 'reject') {
              mock.status = 'stopped';
              record('SUBMIT_TRANSACTION', 'rejected');
              respond({
                signedTransaction: '',
                error: mock.config.signRejectMessage,
              });
              return;
            }

            if (mock.config.sign === 'delay') {
              mock.status = 'awaiting_signature';
              mock.pending.push({
                messageId: String(data.messageId ?? ''),
                transactionXdr: xdr,
                respond,
              });
              record('SUBMIT_TRANSACTION', 'parked');
              return;
            }

            mock.status = 'idle';
            record('SUBMIT_TRANSACTION', 'approved');
            respond({ signedTransaction: xdr, error: '' });
            return;
          }

          default:
            record(String(data.type));
            respond({ error: `Unsupported operation: ${String(data.type)}` });
        }
      });
    },
    { initial: opts },
  );

  // If the document is already loaded, apply config immediately so mid-test
  // reconfiguration works without a navigation.
  await page.evaluate((next) => {
    const g = window as Window & { __sgvWalletMock?: WalletMockController; freighter?: unknown };
    g.freighter = { __freighterEmulated: true };
    const mock = g.__sgvWalletMock;
    if (!mock) {
      // Init script has not run yet (first navigation still pending).
      return;
    }
    if (mock.pending.length) {
      for (const pending of mock.pending) {
        pending.respond({
          signedTransaction: '',
          error: 'Wallet mock reset: cancelled delayed signature.',
        });
        mock.log.push({
          type: 'SUBMIT_TRANSACTION',
          at: Date.now(),
          outcome: 'cancelled',
        });
      }
      mock.pending = [];
    }
    mock.config = {
      publicKey: next.publicKey,
      networkPassphrase: next.networkPassphrase,
      sorobanRpcUrl: next.sorobanRpcUrl,
      access: next.access,
      sign: next.sign,
      signRejectMessage: next.signRejectMessage,
    };
    mock.status = 'idle';
  }, opts);
}

/** Reads the emulated extension's request log from the page. */
export async function readBridgeLog(page: Page): Promise<BridgeEventLogEntry[]> {
  return page.evaluate(() => window.__sgvWalletMock?.log ?? []);
}

/** Observable mock status for assertions (idle / awaiting / stopped). */
export async function readWalletMockSnapshot(page: Page): Promise<WalletMockSnapshot> {
  return page.evaluate(() => {
    const mock = window.__sgvWalletMock;
    if (!mock) {
      return {
        status: 'idle' as const,
        sign: 'approve' as const,
        access: 'grant' as const,
        pendingCount: 0,
        log: [],
      };
    }
    return {
      status: mock.status,
      sign: mock.config.sign,
      access: mock.config.access,
      pendingCount: mock.pending.length,
      log: [...mock.log],
    };
  });
}

/** Change sign behaviour without reinstalling the bridge (recovery / next attempt). */
export async function setWalletMockSignBehavior(page: Page, sign: SignBehavior): Promise<void> {
  await page.evaluate((nextSign) => {
    const mock = window.__sgvWalletMock;
    if (!mock) {
      throw new Error('Wallet mock is not installed. Call mockFreighter() first.');
    }
    mock.config.sign = nextSign;
    if (nextSign !== 'delay' && mock.status === 'awaiting_signature' && mock.pending.length === 0) {
      mock.status = 'idle';
    }
  }, sign);
}

/**
 * Resolve every parked (delayed) signature.
 * - `approve` — echo XDR (still no live funds)
 * - `reject` — stop with the configured reject message
 */
export async function resolveDelayedSignatures(
  page: Page,
  outcome: 'approve' | 'reject' = 'approve',
): Promise<number> {
  return page.evaluate((nextOutcome) => {
    const mock = window.__sgvWalletMock;
    if (!mock) {
      throw new Error('Wallet mock is not installed. Call mockFreighter() first.');
    }
    const parked = mock.pending.splice(0, mock.pending.length);
    for (const pending of parked) {
      if (nextOutcome === 'reject') {
        pending.respond({
          signedTransaction: '',
          error: mock.config.signRejectMessage,
        });
        mock.log.push({
          type: 'SUBMIT_TRANSACTION',
          at: Date.now(),
          outcome: 'rejected',
        });
      } else {
        pending.respond({
          signedTransaction: pending.transactionXdr,
          error: '',
        });
        mock.log.push({
          type: 'SUBMIT_TRANSACTION',
          at: Date.now(),
          outcome: 'approved',
        });
      }
    }
    mock.status = nextOutcome === 'reject' ? 'stopped' : 'idle';
    mock.config.sign = 'approve';
    return parked.length;
  }, outcome);
}

/**
 * Clear stop / recovery path for reruns: cancel delayed signatures, restore
 * approve+grant defaults, and leave the bridge ready for the next attempt.
 */
export async function resetWalletMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mock = window.__sgvWalletMock;
    if (!mock) {
      return;
    }
    for (const pending of mock.pending) {
      pending.respond({
        signedTransaction: '',
        error: 'Wallet mock reset: cancelled delayed signature.',
      });
      mock.log.push({
        type: 'SUBMIT_TRANSACTION',
        at: Date.now(),
        outcome: 'cancelled',
      });
    }
    mock.pending = [];
    mock.config.sign = 'approve';
    mock.config.access = 'grant';
    mock.status = 'idle';
  });
}
