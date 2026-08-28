/**
 * Tests for #543: funding milestone events (25 / 50 / 75 / 100 %).
 *
 * Each milestone must fire exactly once per campaign. No duplicate emissions.
 * A single large pledge that crosses several thresholds at once should emit
 * all crossed milestones.
 */
import fs from 'fs';
import path from 'path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB_PATH = path.join('/tmp', `milestone-test-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = '';

type CampaignStoreModule = typeof import('../campaignStore');
type DbModule = typeof import('../db');
type EventHistoryModule = typeof import('../eventHistory');

let createCampaign: CampaignStoreModule['createCampaign'];
let addPledge: CampaignStoreModule['addPledge'];
let getMilestonesReached: CampaignStoreModule['getMilestonesReached'];
let initCampaignStore: CampaignStoreModule['initCampaignStore'];
let getDb: DbModule['getDb'];
let getCampaignHistory: EventHistoryModule['getCampaignHistory'];

const CREATOR = `G${'A'.repeat(55)}`;
const CONTRIBUTOR = `G${'B'.repeat(55)}`;
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7; // 1 week

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  ({ createCampaign, addPledge, getMilestonesReached, initCampaignStore } =
    await import('../campaignStore'));
  ({ getDb } = await import('../db'));
  ({ getCampaignHistory } = await import('../eventHistory'));
  initCampaignStore();
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM campaign_events').run();
  db.prepare('DELETE FROM pledges').run();
  db.prepare('DELETE FROM campaigns').run();
});

function makeCampaign(target = 100) {
  return createCampaign({
    creator: CREATOR,
    title: 'Milestone Test',
    description: 'desc',
    assetCode: 'USDC',
    targetAmount: target,
    deadline: FUTURE_DEADLINE,
  });
}

describe('milestone events (#543)', () => {
  it('emits 25% milestone when pledge crosses 25% threshold', () => {
    const c = makeCampaign(100);
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });

    const milestones = getMilestonesReached(c.id);
    expect(milestones).toContain(25);
    expect(milestones).not.toContain(50);
    expect(milestones).not.toContain(75);
    expect(milestones).not.toContain(100);
  });

  it('emits 50% milestone when pledge crosses 50% threshold', () => {
    const c = makeCampaign(100);
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50, assetCode: 'USDC' });

    const milestones = getMilestonesReached(c.id);
    expect(milestones).toContain(25);
    expect(milestones).toContain(50);
    expect(milestones).not.toContain(75);
    expect(milestones).not.toContain(100);
  });

  it('emits all four milestones when a single pledge fully funds the campaign', () => {
    const c = makeCampaign(100);
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 100, assetCode: 'USDC' });

    const milestones = getMilestonesReached(c.id);
    expect(milestones).toEqual([25, 50, 75, 100]);
  });

  it('does not emit duplicate milestones on subsequent pledges', () => {
    const c = makeCampaign(100);
    // First pledge crosses 25%
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });
    // Second pledge stays under 50%
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 20, assetCode: 'USDC' });

    const history = getCampaignHistory(c.id);
    const milestoneEvents = history.filter((e) => e.eventType === 'milestone_reached');
    // Only the first milestone should have been recorded once
    const pcts = milestoneEvents.map((e) => (e.metadata as { milestonePct?: number })?.milestonePct);
    const pct25Count = pcts.filter((p) => p === 25).length;
    expect(pct25Count).toBe(1);
  });

  it('emits 75% and 100% milestones after incremental pledges', () => {
    const c = makeCampaign(100);
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 25, assetCode: 'USDC' });

    const milestones = getMilestonesReached(c.id);
    expect(milestones.sort((a, b) => a - b)).toEqual([25, 50, 75, 100]);
  });

  it('getMilestonesReached returns empty array for a campaign with no pledges', () => {
    const c = makeCampaign(100);
    expect(getMilestonesReached(c.id)).toEqual([]);
  });

  it('records milestone_reached event with correct metadata', () => {
    const c = makeCampaign(100);
    addPledge(c.id, { contributor: CONTRIBUTOR, amount: 50, assetCode: 'USDC' });

    const history = getCampaignHistory(c.id);
    const event25 = history.find(
      (e) =>
        e.eventType === 'milestone_reached' &&
        (e.metadata as { milestonePct?: number })?.milestonePct === 25,
    );
    const event50 = history.find(
      (e) =>
        e.eventType === 'milestone_reached' &&
        (e.metadata as { milestonePct?: number })?.milestonePct === 50,
    );

    expect(event25).toBeDefined();
    expect(event50).toBeDefined();
    expect((event25!.metadata as { totalPledged?: number })?.totalPledged).toBe(50);
    expect((event50!.metadata as { totalPledged?: number })?.totalPledged).toBe(50);
  });
});
