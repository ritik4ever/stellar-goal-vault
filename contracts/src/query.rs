use soroban_sdk::{Env, Vec};

use crate::{Campaign, CampaignStatus, CampaignSummary, DataKey, MAX_CAMPAIGN_BATCH_SIZE};

pub(crate) fn try_read_campaign(env: &Env, campaign_id: u64) -> Option<Campaign> {
    env.storage()
        .persistent()
        .get(&DataKey::Campaign(campaign_id))
}

pub(crate) fn read_campaign(env: &Env, campaign_id: u64) -> Campaign {
    try_read_campaign(env, campaign_id).unwrap_or_else(|| panic!("campaign not found"))
}

pub(crate) fn campaign_status(env: &Env, campaign: &Campaign) -> CampaignStatus {
    if campaign.canceled {
        CampaignStatus::Canceled
    } else if campaign.claimed {
        CampaignStatus::Claimed
    } else if campaign.pledged_amount >= campaign.target_amount {
        CampaignStatus::Funded
    } else if env.ledger().timestamp() >= campaign.deadline {
        CampaignStatus::Failed
    } else {
        CampaignStatus::Open
    }
}

pub(crate) fn campaign_summary(env: &Env, id: u64, campaign: &Campaign) -> CampaignSummary {
    CampaignSummary {
        id,
        creator: campaign.creator.clone(),
        target_amount: campaign.target_amount,
        pledged_amount: campaign.pledged_amount,
        deadline: campaign.deadline,
        created_at: campaign.created_at,
        contributor_count: campaign.contributor_count,
        metadata: campaign.metadata.clone(),
        status: campaign_status(env, campaign),
    }
}

pub(crate) fn campaigns_batch(env: &Env, ids: &Vec<u64>) -> Vec<Option<CampaignSummary>> {
    if ids.len() > MAX_CAMPAIGN_BATCH_SIZE {
        panic!("batch size exceeds maximum");
    }

    let mut results = Vec::new(env);
    for id in ids.iter() {
        let entry = try_read_campaign(env, id).map(|campaign| campaign_summary(env, id, &campaign));
        results.push_back(entry);
    }
    results
}
