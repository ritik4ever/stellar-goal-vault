import { APIRequestContext } from '@playwright/test';
import { Campaign, ContributorSummary, createApi } from './api';
import { TEST_CONTRIBUTORS } from './wallets';

export interface PledgeGroup {
  contributor: string;
  amount: number;
  assetCode?: string;
}

/** Deterministic pledge writes: single, batched, and exact-target funding. */
export class PledgeBuilder {
  constructor(private readonly request: APIRequestContext) {}

  async add(campaignId: string, group: PledgeGroup): Promise<Campaign> {
    return createApi(this.request).addPledge(campaignId, {
      contributor: group.contributor,
      amount: group.amount,
      assetCode: group.assetCode,
    });
  }

  async addMany(campaignId: string, groups: PledgeGroup[]): Promise<Campaign> {
    let updated = await this.refresh(campaignId);
    for (const group of groups) {
      updated = await this.add(campaignId, group);
    }
    return updated;
  }

  async fundToTarget(
    campaignId: string,
    targetAmount: number,
    contributor: string = TEST_CONTRIBUTORS.dave,
  ): Promise<Campaign> {
    return this.add(campaignId, { contributor, amount: targetAmount });
  }

  async contributors(campaignId: string): Promise<ContributorSummary[]> {
    return createApi(this.request).getContributors(campaignId);
  }

  private async refresh(campaignId: string): Promise<Campaign> {
    const campaigns = await createApi(this.request).listCampaigns();
    const campaign = campaigns.find((entry) => entry.id === campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found after pledge.`);
    return campaign;
  }
}
