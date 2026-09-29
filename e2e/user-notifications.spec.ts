import { expect, test } from '@playwright/test';

const CREATOR = 'GDOGOQQQWCIPOHLIYHQIVI5HKYHYI6IDBGRW245JZC623TVFFKFQZCKQ';
const CONTRIBUTOR = 'GBBXILIJHRPV2GWBGPQLWSGR57FO6OODNMBZB5EUKBFX3MRINA7NMKUI';

test.describe('User Notifications', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        requestAccess: () => Promise.resolve(CREATOR),
        getNetworkDetails: () =>
          Promise.resolve({
            networkPassphrase: 'Test SDF Network ; September 2015',
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
          }),
        signTransaction: (xdr: string) => Promise.resolve(xdr),
      };
    });
  });

  test('shows pledge notification and marks it as read', async ({ page, request }) => {
    const campaignTitle = `Notification test ${Date.now()}`;
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Create campaign with CREATOR as the creator
    const createResponse = await request.post('/api/campaigns', {
      data: {
        creator: CREATOR,
        title: campaignTitle,
        description: 'A campaign to verify notification E2E coverage.',
        acceptedTokens: ['USDC'],
        targetAmount: 100,
        deadline,
      },
    });
    expect(createResponse.status()).toBe(201);
    const campaignId = (await createResponse.json()).data.data.id;

    // Pledge from a different contributor → triggers new_pledge notification for creator
    const pledgeResponse = await request.post(`/api/campaigns/${campaignId}/pledges`, {
      data: {
        contributor: CONTRIBUTOR,
        amount: 50,
        assetCode: 'USDC',
      },
    });
    expect(pledgeResponse.status()).toBe(201);

    // Verify notification exists via API
    const notifResponse = await request.get(
      `/api/notifications?wallet=${encodeURIComponent(CREATOR)}`,
    );
    expect(notifResponse.status()).toBe(200);
    const notifBody = await notifResponse.json();
    expect(notifBody.unreadCount).toBe(1);
    expect(notifBody.data[0].type).toBe('new_pledge');

    // Load the app and connect wallet
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.locator('button:has-text("Freighter")').click();
    await expect(page.locator('.wallet-widget--connected')).toBeVisible();

    // Open notification bell
    await page.getByRole('button', { name: /Notifications/ }).click();

    // Verify notification is visible in the UI
    await expect(page.locator('.notification-item')).toHaveCount(1);
    await expect(page.locator('.notification-item-unread')).toBeVisible();
    await expect(page.locator('.notification-item-title')).toContainText(
      'New on-chain pledge',
    );

    // Mark all as read
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await expect(page.locator('.notification-item-unread')).toHaveCount(0);

    // Verify via API that notifications are marked as read
    const readResponse = await request.get(
      `/api/notifications?wallet=${encodeURIComponent(CREATOR)}`,
    );
    const readBody = await readResponse.json();
    expect(readBody.unreadCount).toBe(0);
  });

  test('shows empty state when there are no notifications', async ({ page }) => {
    // Intercept the notifications API and return an empty list
    await page.route('**/api/notifications?*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { data: [], total: 0, unreadCount: 0 },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.locator('button:has-text("Freighter")').click();
    await expect(page.locator('.wallet-widget--connected')).toBeVisible();

    // Open notification bell — should show empty state
    await page.getByRole('button', { name: /Notifications/ }).click();
    await expect(page.locator('.notification-empty')).toContainText(
      'No notifications yet',
    );
  });

  test('returns 400 when wallet parameter is missing', async ({ request }) => {
    const response = await request.get('/api/notifications');
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe('MISSING_WALLET');
  });
});
