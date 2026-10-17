import type { Page } from '@playwright/test';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export type AccessBehavior = 'grant' | 'deny';
export type SignBehavior = 'sign' | 'reject' | 'empty';

export interface FreighterBridgeOptions {
  /** Public key returned by requestAccess. */
  publicKey: string;
  /** Network the emulated extension reports via getNetworkDetails. */
  networkPassphrase?: string;
  /** Soroban RPC URL the emulated extension reports. */
  sorobanRpcUrl?: string;
  /** Behaviour of requestAccess (REQUEST_PUBLIC_KEY bridge message). */
  access?: AccessBehavior;
  /** Behaviour of signTransaction (SUBMIT_TRANSACTION bridge message). */
  sign?: SignBehavior;
  /** Error message used when `sign: 'reject'`. */
  signRejectMessage?: string;
}

interface BridgeEventLogEntry {
  type: string;
  at: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Window {
    __freighterBridgeLog?: BridgeEventLogEntry[];
  }
}

/**
 * Emulates the Freighter browser extension inside the page.
 *
 * `@stellar/freighter-api` v2 talks to the extension over `window.postMessage`:
 * requests are posted with `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"` and the
 * extension replies with `source: "FREIGHTER_EXTERNAL_MSG_RESPONSE"` and the
 * matching request id. The installed v2.0.0 build reads the id back from
 * `messagedId` (sic) while sending `messageId`, so responses carry both spellings.
 *
 * Setting the `window.freighter` sentinel also satisfies `isConnected()`, which
 * short-circuits when the sentinel is present.
 */
export async function installFreighterBridge(
  page: Page,
  options: FreighterBridgeOptions,
): Promise<void> {
  await page.addInitScript(
    ({ opts }) => {
      const bridgeLog: { type: string; at: number }[] = [];
      (window as unknown as { __freighterBridgeLog: unknown }).__freighterBridgeLog = bridgeLog;

      // Sentinel consumed by isConnected() in @stellar/freighter-api v2.
      (window as unknown as { freighter?: unknown }).freighter = {
        __freighterEmulated: true,
      };

      window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window) {
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
          window.postMessage(
            {
              ...payload,
              messageId: data.messageId,
              messagedId: data.messageId,
              source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
            },
            window.location.origin,
          );
        };

        bridgeLog.push({ type: String(data.type), at: Date.now() });

        switch (data.type) {
          case 'REQUEST_CONNECTION_STATUS':
            respond({ isConnected: true });
            return;

          case 'REQUEST_PUBLIC_KEY':
          case 'REQUEST_ACCESS':
            if (opts.access === 'deny') {
              respond({ publicKey: '', error: 'The user declined access to their account.' });
              return;
            }
            respond({ publicKey: opts.publicKey, error: '' });
            return;

          case 'REQUEST_NETWORK_DETAILS': {
            const isTestnet = opts.networkPassphrase === 'Test SDF Network ; September 2015';
            respond({
              networkDetails: {
                network: isTestnet ? 'TESTNET' : 'PUBLIC',
                networkName: isTestnet ? 'Test Net' : 'Pub Net 2',
                networkUrl: '',
                networkPassphrase: opts.networkPassphrase,
                sorobanRpcUrl: opts.sorobanRpcUrl,
              },
              error: '',
            });
            return;
          }

          case 'SUBMIT_TRANSACTION':
            if (opts.sign === 'reject') {
              respond({
                signedTransaction: '',
                error: opts.signRejectMessage ?? 'User declined to sign the transaction.',
              });
              return;
            }
            if (opts.sign === 'empty') {
              // Signs but returns nothing — exercised by the service guard.
              respond({ signedTransaction: '', error: '' });
              return;
            }
            respond({ signedTransaction: data.transactionXdr ?? '', error: '' });
            return;

          default:
            respond({ error: `Unsupported operation: ${String(data.type)}` });
        }
      });
    },
    { opts: options },
  );
}

/** Reads the emulated extension's request log from the page. */
export async function readBridgeLog(page: Page): Promise<BridgeEventLogEntry[]> {
  return page.evaluate(() => window.__freighterBridgeLog ?? []);
}
