import { test, expect } from './fixtures';
import {
  mockFreighter,
  recoverWalletMock,
  resetWalletMock,
  resolveDelayedSignatures,
  readBridgeLog,
  setWalletMockSignBehavior,
  readWalletMockSnapshot,
  TEST_CONTRIBUTORS,
  TESTNET_PASSPHRASE,
} from './fixtures';

const CONTRIBUTOR = TEST_CONTRIBUTORS.dave;
const SAMPLE_XDR = `AAAA${'B'.repeat(80)}==`;

/**
 * Drives the Freighter postMessage bridge the same way @stellar/freighter-api
 * does, without loading the extension or spending funds.
 */
async function bridgeRequest(
  page: import('@playwright/test').Page,
  type: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ requestType, payload }) => {
      const messageId = `sgv-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error(`Timed out waiting for Freighter bridge response to ${requestType}`));
        }, 3_000);

        function onMessage(event: MessageEvent) {
          const data = event.data as {
            source?: string;
            messageId?: string;
            messagedId?: string;
          } | null;
          if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_RESPONSE') {
            return;
          }
          if (data.messageId !== messageId && data.messagedId !== messageId) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(data as Record<string, unknown>);
        }

        window.addEventListener('message', onMessage);
        window.postMessage(
          {
            source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
            messageId,
            type: requestType,
            ...payload,
          },
          '*',
        );
      });
    },
    { requestType: type, payload: extra },
  );
}

test.describe('Wallet flow E2E fixtures (rerun-safe)', () => {
  /** Fixture-only page: no app server, no Freighter extension, no live funds. */
  async function openFixturePage(page: import('@playwright/test').Page) {
    await page.goto('about:blank');
  }

  test('approves a signature without live funds and stays idle', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR);
    await openFixturePage(page);

    const access = await bridgeRequest(page, 'REQUEST_ACCESS');
    expect(access.publicKey).toBe(CONTRIBUTOR);
    expect(access.error).toBe('');

    const network = await bridgeRequest(page, 'REQUEST_NETWORK_DETAILS');
    const details = network.networkDetails as { networkPassphrase?: string };
    expect(details.networkPassphrase).toBe(TESTNET_PASSPHRASE);

    const signed = await bridgeRequest(page, 'SUBMIT_TRANSACTION', {
      transactionXdr: SAMPLE_XDR,
    });
    expect(signed.signedTransaction).toBe(SAMPLE_XDR);
    expect(signed.error).toBe('');

    const snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.log).toContainEqual(
      expect.objectContaining({ type: 'SUBMIT_TRANSACTION', outcome: 'approved' }),
    );
  });

  test('reject stops signing immediately and recovers for a later approve', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR, { sign: 'reject' });
    await openFixturePage(page);

    const rejected = await bridgeRequest(page, 'SUBMIT_TRANSACTION', {
      transactionXdr: SAMPLE_XDR,
    });
    expect(rejected.signedTransaction).toBe('');
    expect(String(rejected.error)).toMatch(/declin/i);

    let snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('stopped');
    expect(snapshot.pendingCount).toBe(0);
    expect(await readBridgeLog(page)).toContainEqual(
      expect.objectContaining({ type: 'SUBMIT_TRANSACTION', outcome: 'rejected' }),
    );

    // Recovery path: reset + approve, then a second attempt succeeds on the
    // same page (rerun-safe without navigation or live wallet state).
    await recoverWalletMock(page, 'approve');
    snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.sign).toBe('approve');

    const approved = await bridgeRequest(page, 'SUBMIT_TRANSACTION', {
      transactionXdr: SAMPLE_XDR,
    });
    expect(approved.signedTransaction).toBe(SAMPLE_XDR);
    expect(approved.error).toBe('');
  });

  test('delay parks the signature until resolve or reset', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR, { sign: 'delay' });
    await openFixturePage(page);

    const delayed = page.evaluate(
      ({ xdr }) => {
        const messageId = `sgv-delay-${Date.now()}`;
        return new Promise<Record<string, unknown>>((resolve) => {
          function onMessage(event: MessageEvent) {
            const data = event.data as {
              source?: string;
              messageId?: string;
              messagedId?: string;
            } | null;
            if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_RESPONSE') {
              return;
            }
            if (data.messageId !== messageId && data.messagedId !== messageId) {
              return;
            }
            window.removeEventListener('message', onMessage);
            resolve(data as Record<string, unknown>);
          }
          window.addEventListener('message', onMessage);
          window.postMessage(
            {
              source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
              messageId,
              type: 'SUBMIT_TRANSACTION',
              transactionXdr: xdr,
            },
            '*',
          );
        });
      },
      { xdr: SAMPLE_XDR },
    );

    await expect
      .poll(async () => (await readWalletMockSnapshot(page)).status)
      .toBe('awaiting_signature');
    await expect
      .poll(async () => (await readWalletMockSnapshot(page)).pendingCount)
      .toBe(1);

    const resolvedCount = await resolveDelayedSignatures(page, 'approve');
    expect(resolvedCount).toBe(1);

    const response = await delayed;
    expect(response.signedTransaction).toBe(SAMPLE_XDR);
    expect(response.error).toBe('');

    const snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.sign).toBe('approve');
    expect(await readBridgeLog(page)).toContainEqual(
      expect.objectContaining({ type: 'SUBMIT_TRANSACTION', outcome: 'approved' }),
    );
  });

  test('delay can be resolved as a rejection with an observable stop', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR, { sign: 'delay' });
    await openFixturePage(page);

    const delayed = page.evaluate(
      ({ xdr }) => {
        const messageId = `sgv-delayed-reject-${Date.now()}`;
        return new Promise<Record<string, unknown>>((resolve) => {
          function onMessage(event: MessageEvent) {
            const data = event.data as {
              source?: string;
              messageId?: string;
              messagedId?: string;
            } | null;
            if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_RESPONSE') {
              return;
            }
            if (data.messageId !== messageId && data.messagedId !== messageId) {
              return;
            }
            window.removeEventListener('message', onMessage);
            resolve(data as Record<string, unknown>);
          }
          window.addEventListener('message', onMessage);
          window.postMessage(
            {
              source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
              messageId,
              type: 'SUBMIT_TRANSACTION',
              transactionXdr: xdr,
            },
            '*',
          );
        });
      },
      { xdr: SAMPLE_XDR },
    );

    await expect.poll(async () => (await readWalletMockSnapshot(page)).pendingCount).toBe(1);

    expect(await resolveDelayedSignatures(page, 'reject')).toBe(1);

    const response = await delayed;
    expect(response.signedTransaction).toBe('');
    expect(String(response.error)).toMatch(/declin/i);

    const snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('stopped');
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.sign).toBe('approve');
    expect(await readBridgeLog(page)).toContainEqual(
      expect.objectContaining({ type: 'SUBMIT_TRANSACTION', outcome: 'rejected' }),
    );
  });

  test('reset cancels a delayed signature so the next run is not stuck', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR, { sign: 'delay' });
    await openFixturePage(page);

    const cancelled = page.evaluate(({ xdr }) => {
      const messageId = `sgv-cancel-${Date.now()}`;
      return new Promise<Record<string, unknown>>((resolve) => {
        function onMessage(event: MessageEvent) {
          const data = event.data as {
            source?: string;
            messageId?: string;
            messagedId?: string;
          } | null;
          if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_RESPONSE') {
            return;
          }
          if (data.messageId !== messageId && data.messagedId !== messageId) {
            return;
          }
          window.removeEventListener('message', onMessage);
          resolve(data as Record<string, unknown>);
        }
        window.addEventListener('message', onMessage);
        window.postMessage(
          {
            source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
            messageId,
            type: 'SUBMIT_TRANSACTION',
            transactionXdr: xdr,
          },
          '*',
        );
      });
    }, { xdr: SAMPLE_XDR });

    await expect
      .poll(async () => (await readWalletMockSnapshot(page)).pendingCount)
      .toBe(1);

    // Invalid retry setup must fail before cancelling the parked signature
    // or installing a new bridge that could approve the next request.
    await expect(
      mockFreighter(page, CONTRIBUTOR, { sorobanRpcUrl: 'file:///tmp/rpc' }),
    ).rejects.toThrow('Wallet fixture setup:');
    expect((await readWalletMockSnapshot(page)).status).toBe('awaiting_signature');
    expect((await readWalletMockSnapshot(page)).pendingCount).toBe(1);

    await resetWalletMock(page);

    const response = await cancelled;
    expect(String(response.error)).toMatch(/reset|cancel/i);
    expect(response.signedTransaction).toBe('');

    let snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.sign).toBe('approve');

    // Immediate re-run on the same page succeeds after recovery.
    await setWalletMockSignBehavior(page, 'approve');
    const approved = await bridgeRequest(page, 'SUBMIT_TRANSACTION', {
      transactionXdr: SAMPLE_XDR,
    });
    expect(approved.signedTransaction).toBe(SAMPLE_XDR);
    snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.status).toBe('idle');
  });

  test('repeated mockFreighter installs cancel prior delays (retry-safe)', async ({ page }) => {
    await mockFreighter(page, CONTRIBUTOR, { sign: 'delay' });
    await openFixturePage(page);

    void bridgeRequest(page, 'SUBMIT_TRANSACTION', { transactionXdr: SAMPLE_XDR }).catch(() => {
      // The first attempt may reject when the mock is reinstalled.
    });

    await expect
      .poll(async () => (await readWalletMockSnapshot(page)).pendingCount)
      .toBe(1);

    // Simulates a Playwright retry / second setup on the same page context.
    await mockFreighter(page, CONTRIBUTOR, { sign: 'approve' });

    const snapshot = await readWalletMockSnapshot(page);
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.sign).toBe('approve');
    expect(snapshot.status).toBe('idle');

    const approved = await bridgeRequest(page, 'SUBMIT_TRANSACTION', {
      transactionXdr: SAMPLE_XDR,
    });
    expect(approved.signedTransaction).toBe(SAMPLE_XDR);
  });
});
