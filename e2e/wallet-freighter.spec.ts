import { test, expect } from './fixtures';
import { DashboardPage } from './dashboard';
import {
  deadlineInHours,
  mockFreighter,
  mockAppConfigSoroban,
  readBridgeLog,
  TEST_CONTRIBUTORS,
  TEST_CREATORS,
  MAINNET_PASSPHRASE,
} from './fixtures';

const CONTRIBUTOR = TEST_CONTRIBUTORS.dave;

/**
 * Opens a campaign's detail panel via its deep link.
 *
 * Clicking rows in the campaign board is fragile: the board is
 * window-virtualized and its IntersectionObserver sentinel auto-loads every
 * list page, so the visible window churns and rows detach mid-click. The app
 * supports /campaigns/:id routing (bootstrap selects the URL param), which is
 * deterministic under any list size.
 */
async function selectCampaign(page: import('@playwright/test').Page, title: string, campaignId?: string): Promise<void> {
  let id = campaignId;
  if (!id) {
    const response = await page.request.get(`/api/campaigns?search=${encodeURIComponent(title)}`);
    const body = await response.json();
    const found = (body.data as Array<{ id: string; title: string }>).find(
      (entry) => entry.title === title,
    );
    expect(found, `campaign "${title}" discoverable via API`).toBeDefined();
    id = found!.id;
  }
  await page.goto(`/campaigns/${id}`);
  await expect(page.locator('.detail-panel h2')).toHaveText(title);
}

/** Intercepts /api/config so the UI treats the wallet integration as ready. */
async function interceptConfig(page: import('@playwright/test').Page, rpcUrl: string): Promise<void> {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { data: mockAppConfigSoroban(rpcUrl) },
    }),
  );
}

test.describe('Freighter wallet integration', () => {
  test.describe('connection flows', () => {
    test('connects through the wallet picker and shows the connected pill', async ({ page }) => {
      await mockFreighter(page, CONTRIBUTOR);
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      // Header widget opens the picker (no implicit wallet selection).
      await dashboard.connectWalletButton.click();
      await expect(page.locator('.wallet-picker-modal')).toBeVisible();
      await expect(page.locator('.wallet-option--available')).toContainText('Freighter');

      await page.locator('.wallet-option:has-text("Freighter")').click();

      await expect(page.locator('.wallet-widget--connected')).toBeVisible();
      // sr-only labels inside these spans count toward textContent, so
      // assert containment rather than exact text.
      await expect(page.locator('.wallet-widget__address')).toContainText(
        `${CONTRIBUTOR.slice(0, 4)}…${CONTRIBUTOR.slice(-4)}`,
      );
      await expect(page.locator('.wallet-widget__network-badge')).toContainText('Testnet');
    });

    test('shows a visible error when access is denied', async ({ page }) => {
      await mockFreighter(page, CONTRIBUTOR, { access: 'deny' });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      await dashboard.connectWalletButton.click();
      await page.locator('.wallet-option:has-text("Freighter")').click();

      await expect(page.locator('.wallet-widget__error')).toBeVisible();
      await expect(page.locator('.wallet-widget--connected')).not.toBeVisible();
    });

    test('refuses to connect when the extension is on a different network', async ({ page }) => {
      await mockFreighter(page, CONTRIBUTOR, { networkPassphrase: MAINNET_PASSPHRASE });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      await dashboard.connectWalletButton.click();
      await page.locator('.wallet-option:has-text("Freighter")').click();

      await expect(page.locator('.wallet-widget__error')).toContainText(
        /connected to Stellar Mainnet/i,
      );
      await expect(page.locator('.wallet-widget--connected')).not.toBeVisible();
    });
  });

  test.describe('wallet-signed pledge flow', () => {
    test('completes a signed pledge end-to-end through preview and Freighter', async ({
      page,
      request,
      campaign,
      pledge,
      sorobanRpc,
    }) => {
      await interceptConfig(page, sorobanRpc.url);
      await mockFreighter(page, CONTRIBUTOR, { sorobanRpcUrl: sorobanRpc.url });

      const open = await campaign.create({ state: 'open', targetAmount: 100 });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      await selectCampaign(page, open.title, open.id);

      await dashboard.connectWallet(CONTRIBUTOR);
      await expect(page.locator('.wallet-status')).toContainText('Connected to Stellar Testnet');

      // Pledge button becomes enabled once a wallet is connected.
      await expect(page.locator('form[aria-label="Pledge form"] button[type="submit"]')).toBeEnabled();

      await dashboard.pledge('25');

      // Preview modal surfaces the operation before signing.
      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await expect(preview).toContainText('contribute');
      await expect(preview).toContainText('25 USDC');
      await preview.locator('button:has-text("Confirm and Sign")').click();

      // Freighter (emulated) signs, the mock RPC accepts, and the UI
      // reconciles the pledge through the backend.
      await expect(page.locator('.toast-container')).toContainText('Pledged 25 USDC. Tx: ', {
        timeout: 20_000,
      });
      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('75');

      expect(sorobanRpc.envelopes).toHaveLength(1);
      expect(sorobanRpc.envelopes[0].length).toBeGreaterThan(100);

      const log = await readBridgeLog(page);
      // freighter-api v2 bridges access via REQUEST_ACCESS (REQUEST_PUBLIC_KEY
      // is the legacy name) and signing via SUBMIT_TRANSACTION.
      expect(log.map((entry) => entry.type)).toEqual(
        expect.arrayContaining(['REQUEST_ACCESS', 'SUBMIT_TRANSACTION']),
      );

      // The pledge is now visible through the REST API with the on-chain hash.
      const contributors = await pledge.contributors(open.id);
      expect(contributors).toHaveLength(1);
      expect(contributors[0].contributor).toBe(CONTRIBUTOR);
      expect(contributors[0].totalPledged).toBe(25);
      void request;
    });

    test('surfaces a signing failure without recording the pledge', async ({
      page,
      campaign,
      pledge,
      sorobanRpc,
    }) => {
      await interceptConfig(page, sorobanRpc.url);
      await mockFreighter(page, CONTRIBUTOR, { sorobanRpcUrl: sorobanRpc.url, sign: 'reject' });

      const open = await campaign.create({ state: 'open', targetAmount: 100 });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      await selectCampaign(page, open.title, open.id);
      await dashboard.connectWallet();
      await dashboard.pledge('25');

      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await preview.locator('button:has-text("Confirm and Sign")').click();

      await expect(page.locator('.toast-container')).toContainText(/sign|declin/i, {
        timeout: 15_000,
      });
      expect(sorobanRpc.envelopes).toHaveLength(0);

      const contributors = await pledge.contributors(open.id);
      expect(contributors).toHaveLength(0);
    });

    test('does not submit anything when the user cancels the preview', async ({
      page,
      campaign,
      sorobanRpc,
    }) => {
      await interceptConfig(page, sorobanRpc.url);
      await mockFreighter(page, CONTRIBUTOR, { sorobanRpcUrl: sorobanRpc.url });

      const open = await campaign.create({ state: 'open', targetAmount: 100 });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      await selectCampaign(page, open.title, open.id);
      await dashboard.connectWallet();
      await dashboard.pledge('25');

      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await preview.locator('button:has-text("Cancel")').click();

      await expect(preview).not.toBeVisible();
      expect(sorobanRpc.envelopes).toHaveLength(0);
      await expect(page.locator('.detail-stat:has-text("Remaining") strong')).toHaveText('100');
    });
  });

  test.describe('wallet-signed claim flow', () => {
    test('creator claims through preview and Freighter once claimable', async ({
      page,
      campaign,
      sorobanRpc,
    }) => {
      // Deadline becomes claimable ~36s after creation, so the whole flow
      // cannot fit in the default 30s test timeout.
      test.setTimeout(120_000);
      await interceptConfig(page, sorobanRpc.url);
      await mockFreighter(page, TEST_CREATORS.alice, { sorobanRpcUrl: sorobanRpc.url });

      // Fully pledged so the campaign is claimable (not refundable) once the
      // 36s deadline passes; the deadline also outruns the backend's 30s
      // detail-cache TTL for fresh UI reads.
      const claimable = await campaign.create({
        state: 'open',
        targetAmount: 50,
        pledgedAmount: 50,
        deadline: deadlineInHours(0.01),
      });

      const dashboard = new DashboardPage(page);
      await dashboard.goto();
      await selectCampaign(page, claimable.title, claimable.id);
      await dashboard.connectWallet();

      // Deadline is 36s out: poll past it (plus the backend's 30s detail-cache TTL).
      await campaign.waitForClaimable(claimable.id, 75_000);
      await page.reload();
      await selectCampaign(page, claimable.title, claimable.id);
      await dashboard.connectWallet();

      await dashboard.claim();

      // The claim is previewed before Freighter signs it.
      const preview = page.locator('.modal-content');
      await expect(preview).toContainText('Transaction Preview');
      await preview.locator('button:has-text("Confirm and Sign")').click();

      await expect(page.locator('.toast-container')).toContainText('Campaign claimed successfully', {
        timeout: 20_000,
      });
      expect(sorobanRpc.envelopes).toHaveLength(1);

      const refreshed = await campaign.refresh(claimable.id);
      expect(refreshed.progress.status).toBe('claimed');
    });

    test('rejects the claim action for non-creators', async ({ page, campaign, sorobanRpc }) => {
      test.setTimeout(120_000);
      await interceptConfig(page, sorobanRpc.url);
      await mockFreighter(page, CONTRIBUTOR, { sorobanRpcUrl: sorobanRpc.url });

      const claimable = await campaign.create({
        state: 'open',
        targetAmount: 50,
        pledgedAmount: 50,
        deadline: deadlineInHours(0.01),
      });

      const dashboard = new DashboardPage(page);
      await dashboard.goto();
      await selectCampaign(page, claimable.title, claimable.id);
      await dashboard.connectWallet();

      // Deadline is 36s out: poll past it (plus the backend's 30s detail-cache TTL).
      await campaign.waitForClaimable(claimable.id, 75_000);
      await page.reload();
      await selectCampaign(page, claimable.title, claimable.id);
      await dashboard.connectWallet();

      // The claim button stays enabled for everyone; the creator guard lives
      // in App.handleClaim and surfaces as an error toast instead. No preview
      // modal and no envelope submission may happen for non-creators.
      await dashboard.claim();
      await expect(page.locator('.toast-container')).toContainText(
        /only the campaign creator can claim funds/i,
      );
      expect(sorobanRpc.envelopes).toHaveLength(0);
    });
  });
});
