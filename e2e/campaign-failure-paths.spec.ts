import { expect, test } from '@playwright/test';

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const UNAUTHORIZED_CREATOR = `G${'C'.repeat(55)}`;

function campaignPayload(title: string, deadline: number) {
  return {
    creator: CREATOR,
    title,
    description: 'A campaign used to verify Playwright failure-path coverage.',
    acceptedTokens: ['USDC'],
    targetAmount: 50,
    deadline,
  };
}

test.describe('Campaign failure paths', () => {
  test.describe.configure({ mode: 'serial' });

  test('rejects missing and invalid campaign input', async ({ request }) => {
    const missingFields = await request.post('/api/campaigns', { data: {} });
    expect(missingFields.status()).toBe(400);

    const missingBody = await missingFields.json();
    expect(missingBody.error).toBe('Validation failed');
    expect(missingBody.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['creator'] }),
        expect.objectContaining({ path: ['title'] }),
      ]),
    );

    const invalidFields = await request.post('/api/campaigns', {
      data: {
        ...campaignPayload(`Invalid campaign ${Date.now()}`, Math.floor(Date.now() / 1000) + 60),
        creator: 'not-a-stellar-account',
        targetAmount: 0,
      },
    });
    expect(invalidFields.status()).toBe(400);

    const invalidBody = await invalidFields.json();
    expect(invalidBody.error).toBe('Validation failed');
    expect(invalidBody.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['creator'] }),
        expect.objectContaining({ path: ['targetAmount'] }),
      ]),
    );
  });

  test('rejects unauthorized and duplicate claim actions without creating a second claim', async ({
    request,
  }) => {
    const createResponse = await request.post('/api/campaigns', {
      data: campaignPayload(`Claim failure path ${Date.now()}`, Math.floor(Date.now() / 1000) + 2),
    });
    expect(createResponse.status()).toBe(201);
    const campaignId = (await createResponse.json()).data.id as string;

    const pledgeResponse = await request.post(`/api/campaigns/${campaignId}/pledges`, {
      data: {
        contributor: CONTRIBUTOR,
        amount: 50,
        assetCode: 'USDC',
      },
    });
    expect(pledgeResponse.status()).toBe(201);

    await expect
      .poll(async () => {
        const response = await request.get(`/api/campaigns/${campaignId}`);
        return (await response.json()).data.progress.canClaim;
      })
      .toBe(true);

    const unauthorizedClaim = await request.post(`/api/campaigns/${campaignId}/claim`, {
      data: {
        creator: UNAUTHORIZED_CREATOR,
        transactionHash: 'a'.repeat(64),
        confirmedAt: Math.floor(Date.now() / 1000),
      },
    });
    expect(unauthorizedClaim.status()).toBe(403);
    expect((await unauthorizedClaim.json()).error.code).toBe('FORBIDDEN');

    const claim = await request.post(`/api/campaigns/${campaignId}/claim`, {
      data: {
        creator: CREATOR,
        transactionHash: 'b'.repeat(64),
        confirmedAt: Math.floor(Date.now() / 1000),
      },
    });
    expect(claim.status()).toBe(200);

    const duplicateClaim = await request.post(`/api/campaigns/${campaignId}/claim`, {
      data: {
        creator: CREATOR,
        transactionHash: 'c'.repeat(64),
        confirmedAt: Math.floor(Date.now() / 1000),
      },
    });
    expect(duplicateClaim.status()).toBe(409);
    expect((await duplicateClaim.json()).error.code).toBe('CAMPAIGN_ALREADY_CLAIMED');

    const history = await request.get(`/api/campaigns/${campaignId}/history`);
    expect(history.status()).toBe(200);
    const claimEvents = (await history.json()).data.filter(
      (event: { eventType: string }) => event.eventType === 'claimed',
    );
    expect(claimEvents).toHaveLength(1);
  });

  test('retries a transient campaign-list failure before rendering the empty state', async ({
    page,
  }) => {
    let campaignListRequests = 0;

    await page.route('**/api/config', (route) =>
      route.fulfill({
        json: {
          data: {
            allowedAssets: ['USDC'],
            soroban: {
              enabled: false,
              networkPassphrase: 'Test SDF Network ; September 2015',
              rpcUrl: 'https://soroban-testnet.stellar.org:443',
            },
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
            contractId: '',
            networkPassphrase: 'Test SDF Network ; September 2015',
            contractAmountDecimals: 7,
            walletIntegrationReady: false,
            assetAddresses: {},
          },
        },
      }),
    );
    await page.route('**/api/open-issues', (route) => route.fulfill({ json: { data: [] } }));
    await page.route('**/api/campaigns?*', (route) => {
      campaignListRequests += 1;
      if (campaignListRequests < 3) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'TEMPORARY_FAILURE', message: 'Try again shortly.' } },
        });
      }

      return route.fulfill({
        json: {
          data: [],
          pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
        },
      });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Campaign actions' })).toBeVisible();
    await expect.poll(() => campaignListRequests).toBe(3);
  });
});
