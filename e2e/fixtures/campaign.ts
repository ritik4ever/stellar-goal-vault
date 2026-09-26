import { APIRequestContext, expect } from '@playwright/test';
import { Campaign, CampaignStatus, ClaimPayload, createApi, CreateCampaignPayload } from './api';
import { deadlineInHours, type TestClock } from './time';
import { TEST_CONTRIBUTORS, TEST_CREATORS } from './wallets';

export type FixtureCampaignState = 'open' | 'funded' | 'failed' | 'claimed';

export interface CreateFixtureOptions {
  state?: FixtureCampaignState;
  creator?: string;
  contributor?: string;
  title?: string;
  acceptedTokens?: string[];
  targetAmount?: number;
  /** Partial pledge amount for `open`/`failed` states. */
  pledgedAmount?: number;
  /** Explicit deadline (unix seconds). Defaults derived from `state`. */
  deadline?: number;
  timeoutMs?: number;
}

/**
 * Virtual seconds jumped to move a short-lived fixture past its deadline. Two
 * hours is safely beyond the one-hour deadline used for `failed`/`claimed`, and
 * is instant because the clock is virtual.
 */
const DEADLINE_PASS_SECONDS = 2 * 3600;

/**
 * Creates a campaign in an exact lifecycle state without copying setup blocks
 * or sleeping on wall-clock time. Declarative state transitions (funding,
 * deadline elapsed, claiming) are driven by API writes, the virtual clock, and
 * `expect.poll` over fresh list reads.
 */
export class CampaignBuilder {
  constructor(
    private readonly request: APIRequestContext,
    private readonly scope: string,
    private readonly clock?: TestClock,
  ) {}

  async create(options: CreateFixtureOptions = {}): Promise<Campaign> {
    const api = createApi(this.request);
    const state = options.state ?? 'open';
    const targetAmount = options.targetAmount ?? 100;
    // Failed/claimed fixtures start with a deadline one hour out and are then
    // pushed past it with the virtual clock, so nothing waits on real time.
    const shortLived = state === 'failed' || state === 'claimed';
    const deadline = options.deadline ?? deadlineInHours(shortLived ? 1 : 720);

    const created = await api.createCampaign({
      creator: options.creator ?? TEST_CREATORS.alice,
      title: options.title ?? `E2E ${state} ${this.scope}`,
      description: `Deterministic E2E fixture campaign for state ${state}.`,
      acceptedTokens: options.acceptedTokens ?? ['USDC'],
      targetAmount,
      deadline,
    });

    const pledgeAmount =
      state === 'funded' || state === 'claimed' ? targetAmount : (options.pledgedAmount ?? 0);

    let campaign = created;
    if (pledgeAmount > 0) {
      campaign = await api.addPledge(created.id, {
        contributor: options.contributor ?? TEST_CONTRIBUTORS.dave,
        amount: pledgeAmount,
      });
    }

    if (shortLived) {
      // Move both clocks past the deadline instead of waiting it out.
      await this.clock?.advance(DEADLINE_PASS_SECONDS);
    }

    if (state === 'failed') {
      return this.waitForStatus(created.id, 'failed', options.timeoutMs);
    }

    if (state === 'claimed') {
      await this.waitForClaimable(created.id, options.timeoutMs);
      return api.claimCampaign(created.id, {
        creator: created.creator,
        transactionHash: `f`.repeat(64),
      } satisfies ClaimPayload);
    }

    return campaign;
  }

  async refresh(campaignId: string): Promise<Campaign> {
    const campaigns = await createApi(this.request).listCampaigns();
    const campaign = campaigns.find((entry) => entry.id === campaignId);
    expect(campaign, `campaign ${campaignId} refreshed`).toBeDefined();
    return campaign!;
  }

  async waitForStatus(
    campaignId: string,
    status: CampaignStatus,
    timeoutMs?: number,
  ): Promise<Campaign> {
    await expect
      .poll(() => this.refresh(campaignId), { timeout: timeoutMs ?? 30_000 })
      .toHaveProperty('progress.status', status);
    return this.refresh(campaignId);
  }

  async waitForClaimable(campaignId: string, timeoutMs?: number): Promise<Campaign> {
    await expect
      .poll(() => this.refresh(campaignId), { timeout: timeoutMs ?? 30_000 })
      .toHaveProperty('progress.canClaim', true);
    return this.refresh(campaignId);
  }

  /** Waits until a UI-created campaign (matched by title) becomes claimable. */
  async waitForClaimableByTitle(title: string, timeoutMs?: number): Promise<Campaign> {
    let found: Campaign | undefined;
    await expect
      .poll(
        async () => {
          const campaigns = await createApi(this.request).listCampaigns(title);
          found = campaigns.find((campaign) => campaign.title === title);
          return found?.progress.canClaim;
        },
        { timeout: timeoutMs ?? 30_000 },
      )
      .toBe(true);
    expect(found, `campaign "${title}" became claimable`).toBeDefined();
    return found!;
  }
}
