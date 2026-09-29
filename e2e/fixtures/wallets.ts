import { Page } from '@playwright/test';

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

export async function mockFreighter(page: Page, publicKey: string): Promise<void> {
  await page.addInitScript(
    ({ publicKey }) => {
      (window as { freighter?: unknown }).freighter = {
        isConnected: () => Promise.resolve(true),
        requestAccess: () => Promise.resolve(publicKey),
        getNetworkDetails: () =>
          Promise.resolve({
            networkPassphrase: 'Test SDF Network ; September 2015',
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org:443',
          }),
        signTransaction: (xdr: string) => Promise.resolve(xdr),
      };
    },
    { publicKey },
  );
}
