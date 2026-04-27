#![no_std]



use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    String, Vec,
};

const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const MIN_CONTRIBUTION: i128 = 100;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub creator: Address,
    pub accepted_tokens: Vec<Address>,
    pub target_amount: i128,
    pub pledged_amount: i128,
    pub deadline: u64,
    pub claimed: bool,
    pub canceled: bool,
    pub metadata: String,
    pub contributor_count: u32,
}

#[contracttype]
pub enum DataKey {
    NextCampaignId,
    ContractVersion,
    Campaign(u64),
    Contribution(u64, Address, Address), // (campaign_id, contributor, token)
    CampaignTokenBalance(u64, Address),  // (campaign_id, token)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignCreated {
    pub campaign_id: u64,
    pub creator: Address,
    pub token: Address,
    pub target_amount: i128,
    pub deadline: u64,
    pub metadata: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignPledged {
    pub campaign_id: u64,
    pub contributor: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignClaimed {
    pub campaign_id: u64,
    pub creator: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignRefunded {
    pub campaign_id: u64,
    pub contributor: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignCanceled {
    pub campaign_id: u64,
    pub creator: Address,
}

#[contract]
pub struct StellarGoalVaultContract;

const MAX_CAMPAIGN_DURATION_SECONDS: u64 = 60 * 60 * 24 * 180;

#[contractimpl]
impl StellarGoalVaultContract {
    pub fn create_campaign(
        env: Env,
        creator: Address,
        accepted_tokens: Vec<Address>,
        target_amount: i128,
        deadline: u64,
        metadata: String,
    ) -> u64 {
        creator.require_auth();

        if target_amount <= 0 {
            panic!("target amount must be positive");
        }
        if deadline <= env.ledger().timestamp() {
            panic!("deadline must be in the future");
        }
        if deadline - env.ledger().timestamp() > MAX_CAMPAIGN_DURATION_SECONDS {
            panic!("deadline exceeds maximum campaign duration");
        }
        if accepted_tokens.len() == 0 {
            panic!("at least one accepted token required");
        }

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextCampaignId)
            .unwrap_or(0);
        next_id += 1;

        let campaign = Campaign {
            creator: creator.clone(),
            accepted_tokens: accepted_tokens.clone(),
            target_amount,
            pledged_amount: 0,
            deadline,
            claimed: false,
            canceled: false,
            metadata: metadata.clone(),
            contributor_count: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::NextCampaignId, &next_id);
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(next_id), &campaign);

        // For backward compatibility, publish the first token in the event
        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Create")),
            CampaignCreated {
                campaign_id: next_id,
                creator,
                token: accepted_tokens.get(0).unwrap(),
                target_amount,
                deadline,
                metadata,
            },
        );

        next_id
    }

    pub fn contribute(env: Env, campaign_id: u64, contributor: Address, token: Address, amount: i128) {
        contributor.require_auth();

        if amount < MIN_CONTRIBUTION {
            panic!("contribution below minimum");
        }

        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if campaign.canceled {
            panic!("campaign canceled");
        }
        if env.ledger().timestamp() >= campaign.deadline {
            panic!("campaign deadline reached");
        }
        if campaign.pledged_amount + amount > campaign.target_amount {
            panic!("campaign funding cap exceeded");
        }
        if !campaign.accepted_tokens.iter().any(|t| t == token) {
            panic!("token not accepted by this campaign");
        }

        let token_client = TokenClient::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contributor, &contract_address, &amount);

        // Update campaign pledged amount (valuation)
        campaign.pledged_amount += amount;

        // Only increment contributor_count on first-time pledge
        let contribution_key = DataKey::Contribution(campaign_id, contributor.clone(), token.clone());
        let current_contribution: i128 = env.storage().persistent().get(&contribution_key).unwrap_or(0);
        if current_contribution == 0 {
            campaign.contributor_count += 1;
        }

        // Write updated campaign back to storage
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        let balance_key = DataKey::CampaignTokenBalance(campaign_id, token.clone());
        let current_balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&balance_key, &(current_balance + amount));

        env.storage()
            .persistent()
            .set(&contribution_key, &(current_contribution + amount));

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Pledge")),
            CampaignPledged {
                campaign_id,
                contributor,
                token,
                amount,
            },
        );
    }

    pub fn claim(env: Env, campaign_id: u64, creator: Address) {
        creator.require_auth();

        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.creator != creator {
            panic!("creator mismatch");
        }
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if campaign.canceled {
            panic!("campaign canceled");
        }
        if env.ledger().timestamp() < campaign.deadline {
            panic!("campaign is still active");
        }
        if campaign.pledged_amount < campaign.target_amount {
            panic!("campaign is not funded");
        }

        campaign.claimed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        let contract_address = env.current_contract_address();

        // Transfer all accepted tokens to creator
        for token in campaign.accepted_tokens.iter() {
            let balance_key = DataKey::CampaignTokenBalance(campaign_id, token.clone());
            let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
            
            if balance > 0 {
                let token_client = TokenClient::new(&env, &token);
                token_client.transfer(&contract_address, &creator, &balance);
                
                // Clear the balance
                env.storage().persistent().set(&balance_key, &0_i128);

                env.events().publish(
                    (symbol_short!("Goal"), symbol_short!("Claim")),
                    CampaignClaimed {
                        campaign_id,
                        creator: creator.clone(),
                        token: token.clone(),
                        amount: balance,
                    },
                );
            }
        }
    }

    pub fn refund(env: Env, campaign_id: u64, contributor: Address) {
        contributor.require_auth();

        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if !campaign.canceled && env.ledger().timestamp() < campaign.deadline {
            panic!("campaign is still active");
        }
        if !campaign.canceled && campaign.pledged_amount >= campaign.target_amount {
            panic!("funded campaigns cannot be refunded");
        }

        let contract_address = env.current_contract_address();
        let mut total_refunded = 0;

        for token in campaign.accepted_tokens.iter() {
            let contribution_key = DataKey::Contribution(campaign_id, contributor.clone(), token.clone());
            let contribution: i128 = env.storage().persistent().get(&contribution_key).unwrap_or(0);
            
            if contribution > 0 {
                // Transfer back to contributor
                let token_client = TokenClient::new(&env, &token);
                token_client.transfer(&contract_address, &contributor, &contribution);

                // Update campaign and per-token balances
                campaign.pledged_amount -= contribution;
                let balance_key = DataKey::CampaignTokenBalance(campaign_id, token.clone());
                let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
                env.storage().persistent().set(&balance_key, &(balance - contribution));

                // Reset user contribution for this token
                env.storage().persistent().set(&contribution_key, &0_i128);
                
                total_refunded += contribution;

                env.events().publish(
                    (symbol_short!("Goal"), symbol_short!("Refund")),
                    CampaignRefunded {
                        campaign_id,
                        contributor: contributor.clone(),
                        token: token.clone(),
                        amount: contribution,
                    },
                );
            }
        }

        if total_refunded == 0 {
            panic!("nothing to refund");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Campaign {
        read_campaign(&env, campaign_id)
    }

    pub fn get_contribution(env: Env, campaign_id: u64, contributor: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(campaign_id, contributor, token))
            .unwrap_or(0)
    }

    pub fn get_campaign_token_balance(env: Env, campaign_id: u64, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::CampaignTokenBalance(campaign_id, token))
            .unwrap_or(0)
    }

    pub fn get_contributor_count(env: Env, campaign_id: u64) -> u32 {
        read_campaign(&env, campaign_id).contributor_count
    }

    pub fn get_next_campaign_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextCampaignId)
            .unwrap_or(0)
    }

    /// Returns how many campaigns have been created. Uses the same counter as
    /// [`Self::get_next_campaign_id`] ([`DataKey::NextCampaignId`]): sequential ids `1..=count`.
    pub fn get_campaign_count(env: Env) -> u64 {
        Self::get_next_campaign_id(env)
    }

    pub fn get_version(env: Env) -> String {
        let stored_version: Option<String> =
            env.storage().instance().get(&DataKey::ContractVersion);

        match stored_version {
            Some(version) => version,
            None => {
                let version = String::from_str(&env, CONTRACT_VERSION);
                env.storage()
                    .instance()
                    .set(&DataKey::ContractVersion, &version);
                version
            }
        }
    }
}

fn read_campaign(env: &Env, campaign_id: u64) -> Campaign {
    env.storage()
        .persistent()
        .get(&DataKey::Campaign(campaign_id))
        .unwrap_or_else(|| panic!("campaign not found"))
}
#[cfg(test)]
mod test;