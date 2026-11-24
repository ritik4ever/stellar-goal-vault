import { describe, expect, it } from 'vitest';
import { GoalVaultContract } from './index';

describe('generated Soroban client', () => {
  it('keeps the configured contract identity and typed read methods available without RPC calls', () => {
    const client = new GoalVaultContract(
      'CACMVW2KK4H5FZDFF2AUCAKQTEJMZZWJUIZF23XMRVYQBSXYLHZ6BKWN',
      'http://127.0.0.1:0',
      'Test SDF Network ; September 2015',
    );

    expect(client.getContractId()).toMatch(/^C[A-Z0-9]{55}$/);
    expect(typeof client.getCampaignCount).toBe('function');
    expect(typeof client.getCampaign).toBe('function');
    expect(typeof client.getContribution).toBe('function');
    expect(typeof client.getCampaignTokenBalance).toBe('function');
    expect(typeof client.getContributorCount).toBe('function');
    expect(typeof client.getNextCampaignId).toBe('function');
    expect(typeof client.getVersion).toBe('function');
  });
});
