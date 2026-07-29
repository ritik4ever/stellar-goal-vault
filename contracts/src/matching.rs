#![no_std]

use soroban_sdk::{
    contracttype, symbol_short, token::Client as TokenClient, Address, Env, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchingGrant {
    pub grant_id: u64,
    pub campaign_id: u64,
    pub sponsor: Address,
    pub token: Address,
    pub match_ratio_num: u32,
    pub match_ratio_den: u32,
    pub max_match_cap: i128,
    pub min_campaign_target: i128,
    pub total_match_locked: i128,
    pub released_amount: i128,
    pub claimed: bool,
    pub refunded: bool,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchingGrantCreated {
    pub grant_id: u64,
    pub campaign_id: u64,
    pub sponsor: Address,
    pub token: Address,
    pub match_ratio_num: u32,
    pub match_ratio_den: u32,
    pub max_match_cap: i128,
    pub min_campaign_target: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchingGrantReleased {
    pub grant_id: u64,
    pub campaign_id: u64,
    pub sponsor: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchingGrantRefunded {
    pub grant_id: u64,
    pub campaign_id: u64,
    pub sponsor: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
pub enum DataKey {
    NextMatchingGrantId,
    MatchingGrant(u64),
    CampaignMatchingGrants(u64),
}

pub fn create_matching_grant(
    env: Env,
    sponsor: Address,
    campaign_id: u64,
    token: Address,
    match_ratio_num: u32,
    match_ratio_den: u32,
    max_match_cap: i128,
    min_campaign_target: i128,
) -> u64 {
    crate::require_not_paused(&env);
    sponsor.require_auth();

    if match_ratio_num == 0 {
        panic!("match_ratio_num must be positive");
    }
    if match_ratio_den == 0 {
        panic!("match_ratio_den must be positive");
    }
    if max_match_cap <= 0 {
        panic!("max_match_cap must be positive");
    }
    if min_campaign_target <= 0 {
        panic!("min_campaign_target must be positive");
    }

    let campaign = crate::read_campaign(&env, campaign_id);
    if campaign.claimed {
        panic!("campaign already claimed");
    }
    if campaign.canceled {
        panic!("campaign canceled");
    }
    if env.ledger().timestamp() >= campaign.deadline {
        panic!("campaign deadline reached");
    }
    if campaign.target_amount < min_campaign_target {
        panic!("campaign target amount is less than min_campaign_target");
    }

    if !campaign.accepted_tokens.iter().any(|t| t == token) {
        panic!("token not accepted by this campaign");
    }

    let contract_address = env.current_contract_address();
    let token_client = TokenClient::new(&env, &token);
    token_client.transfer(&sponsor, &contract_address, &max_match_cap);

    let mut next_id: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::NextMatchingGrantId)
        .unwrap_or(0);
    next_id += 1;

    let created_at = env.ledger().timestamp();

    let grant = MatchingGrant {
        grant_id: next_id,
        campaign_id,
        sponsor: sponsor.clone(),
        token: token.clone(),
        match_ratio_num,
        match_ratio_den,
        max_match_cap,
        min_campaign_target,
        total_match_locked: max_match_cap,
        released_amount: 0,
        claimed: false,
        refunded: false,
        created_at,
    };

    env.storage()
        .persistent()
        .set(&DataKey::NextMatchingGrantId, &next_id);
    env.storage()
        .persistent()
        .set(&DataKey::MatchingGrant(next_id), &grant);

    let mut grant_ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::CampaignMatchingGrants(campaign_id))
        .unwrap_or_else(|| Vec::new(&env));
    grant_ids.push_back(next_id);
    env.storage()
        .persistent()
        .set(&DataKey::CampaignMatchingGrants(campaign_id), &grant_ids);

    env.events().publish(
        (symbol_short!("Match"), symbol_short!("Create")),
        MatchingGrantCreated {
            grant_id: next_id,
            campaign_id,
            sponsor,
            token,
            match_ratio_num,
            match_ratio_den,
            max_match_cap,
            min_campaign_target,
        },
    );

    next_id
}

pub fn process_campaign_matching_grants(env: &Env, campaign_id: u64, creator: &Address) {
    let campaign = crate::read_campaign(env, campaign_id);
    let grant_ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::CampaignMatchingGrants(campaign_id))
        .unwrap_or_else(|| Vec::new(env));

    let contract_address = env.current_contract_address();

    for grant_id in grant_ids.iter() {
        let mut grant: MatchingGrant = match env
            .storage()
            .persistent()
            .get(&DataKey::MatchingGrant(grant_id))
        {
            Some(g) => g,
            None => continue,
        };

        if grant.claimed || grant.refunded {
            continue;
        }

        grant.claimed = true;

        let qualified = campaign.pledged_amount >= grant.min_campaign_target;

        let matched_amount = if qualified {
            let raw_match = (campaign.pledged_amount * grant.match_ratio_num as i128)
                / (grant.match_ratio_den as i128);
            if raw_match > grant.max_match_cap {
                grant.max_match_cap
            } else {
                raw_match
            }
        } else {
            0
        };

        let token_client = TokenClient::new(env, &grant.token);

        if matched_amount > 0 {
            token_client.transfer(&contract_address, creator, &matched_amount);
            grant.released_amount = matched_amount;

            env.events().publish(
                (symbol_short!("Match"), symbol_short!("Release")),
                MatchingGrantReleased {
                    grant_id,
                    campaign_id,
                    sponsor: grant.sponsor.clone(),
                    token: grant.token.clone(),
                    amount: matched_amount,
                },
            );
        }

        let unused_match = grant.total_match_locked - matched_amount;
        if unused_match > 0 {
            token_client.transfer(&contract_address, &grant.sponsor, &unused_match);

            env.events().publish(
                (symbol_short!("Match"), symbol_short!("Refund")),
                MatchingGrantRefunded {
                    grant_id,
                    campaign_id,
                    sponsor: grant.sponsor.clone(),
                    token: grant.token.clone(),
                    amount: unused_match,
                },
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::MatchingGrant(grant_id), &grant);
    }
}

pub fn refund_matching_grant(env: Env, grant_id: u64, sponsor: Address) {
    crate::require_not_paused(&env);
    sponsor.require_auth();

    let mut grant: MatchingGrant = env
        .storage()
        .persistent()
        .get(&DataKey::MatchingGrant(grant_id))
        .unwrap_or_else(|| panic!("matching grant not found"));

    if grant.sponsor != sponsor {
        panic!("sponsor mismatch");
    }
    if grant.claimed {
        panic!("matching grant already claimed");
    }
    if grant.refunded {
        panic!("matching grant already refunded");
    }

    let campaign = crate::read_campaign(&env, grant.campaign_id);

    let is_expired = env.ledger().timestamp() >= campaign.deadline;
    if !campaign.canceled && !is_expired {
        panic!("campaign is still active");
    }

    let remaining_escrow = grant.total_match_locked - grant.released_amount;
    if remaining_escrow <= 0 {
        panic!("nothing to refund");
    }

    grant.refunded = true;

    let contract_address = env.current_contract_address();
    let token_client = TokenClient::new(&env, &grant.token);
    token_client.transfer(&contract_address, &sponsor, &remaining_escrow);

    env.storage()
        .persistent()
        .set(&DataKey::MatchingGrant(grant_id), &grant);

    env.events().publish(
        (symbol_short!("Match"), symbol_short!("Refund")),
        MatchingGrantRefunded {
            grant_id,
            campaign_id: grant.campaign_id,
            sponsor,
            token: grant.token,
            amount: remaining_escrow,
        },
    );
}

pub fn get_matching_grant(env: Env, grant_id: u64) -> MatchingGrant {
    env.storage()
        .persistent()
        .get(&DataKey::MatchingGrant(grant_id))
        .unwrap_or_else(|| panic!("matching grant not found"))
}

pub fn get_campaign_matching_grants(env: Env, campaign_id: u64) -> Vec<MatchingGrant> {
    let grant_ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::CampaignMatchingGrants(campaign_id))
        .unwrap_or_else(|| Vec::new(&env));

    let mut grants = Vec::new(&env);
    for grant_id in grant_ids.iter() {
        if let Some(grant) = env
            .storage()
            .persistent()
            .get::<_, MatchingGrant>(&DataKey::MatchingGrant(grant_id))
        {
            grants.push_back(grant);
        }
    }
    grants
}

pub fn calculate_match_amount(env: Env, grant_id: u64) -> i128 {
    let grant = get_matching_grant(env.clone(), grant_id);
    let campaign = crate::read_campaign(&env, grant.campaign_id);

    if campaign.pledged_amount < grant.min_campaign_target {
        return 0;
    }

    let raw_match = (campaign.pledged_amount * grant.match_ratio_num as i128)
        / (grant.match_ratio_den as i128);
    if raw_match > grant.max_match_cap {
        grant.max_match_cap
    } else {
        raw_match
    }
}
