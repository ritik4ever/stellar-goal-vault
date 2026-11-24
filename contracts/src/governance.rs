use soroban_sdk::{Address, Env, Vec};

use crate::DataKey;

/// Checks if a campaign is in pending approval state and returns the
/// number of approvals received so far.
pub fn get_approval_count(env: &Env, campaign_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::CampaignApproval(campaign_id))
        .unwrap_or(0)
}

/// Records an approval for a campaign. Returns the new approval count.
pub fn record_approval(env: &Env, campaign_id: u64) -> u32 {
    let count = get_approval_count(env, campaign_id) + 1;
    env.storage()
        .persistent()
        .set(&DataKey::CampaignApproval(campaign_id), &count);
    count
}

/// Checks if an address is a co-creator of a campaign.
pub fn is_co_creator(env: &Env, campaign_id: u64, address: &Address) -> bool {
    let co_creators: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::CoCreators(campaign_id))
        .unwrap_or_else(|| Vec::new(env));
    co_creators.iter().any(|a| a == *address)
}

/// Checks if an address has already approved a campaign.
pub fn has_approved(env: &Env, campaign_id: u64, address: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::CampaignApprover(campaign_id, address.clone()))
        .unwrap_or(false)
}

/// Marks an address as having approved a campaign.
pub fn mark_approved(env: &Env, campaign_id: u64, address: &Address) {
    env.storage().persistent().set(
        &DataKey::CampaignApprover(campaign_id, address.clone()),
        &true,
    );
}

/// Gets the approval threshold for a campaign.
pub fn get_approval_threshold(env: &Env, campaign_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ApprovalThreshold(campaign_id))
        .unwrap_or(0)
}
