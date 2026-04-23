#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    String,
};

const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Campaign {
    pub creator: Address,
    pub token: Address,
    pub target_amount: i128,
    pub pledged_amount: i128,
    pub deadline: u64,
    pub claimed: bool,
    pub metadata: String,
}

#[contracttype]
pub enum DataKey {
    NextCampaignId,
    ContractVersion,
    Campaign(u64),
    Contribution(u64, Address),
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
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignClaimed {
    pub campaign_id: u64,
    pub creator: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CampaignRefunded {
    pub campaign_id: u64,
    pub contributor: Address,
    pub amount: i128,
}

#[contract]
pub struct StellarGoalVaultContract;

#[contractimpl]
impl StellarGoalVaultContract {
    pub fn create_campaign(
        env: Env,
        creator: Address,
        token: Address,
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

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextCampaignId)
            .unwrap_or(0);
        next_id += 1;

        let campaign = Campaign {
            creator: creator.clone(),
            token: token.clone(),
            target_amount,
            pledged_amount: 0,
            deadline,
            claimed: false,
            metadata: metadata.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::NextCampaignId, &next_id);
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(next_id), &campaign);

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Create")),
            CampaignCreated {
                campaign_id: next_id,
                creator,
                token,
                target_amount,
                deadline,
                metadata,
            },
        );

        next_id
    }

    pub fn contribute(env: Env, campaign_id: u64, contributor: Address, amount: i128) {
        contributor.require_auth();

        if amount <= 0 {
            panic!("amount must be positive");
        }

        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if env.ledger().timestamp() >= campaign.deadline {
            panic!("campaign deadline reached");
        }

        let token_client = TokenClient::new(&env, &campaign.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contributor, &contract_address, &amount);

        campaign.pledged_amount += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        let key = DataKey::Contribution(campaign_id, contributor.clone());
        let current_contribution: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&key, &(current_contribution + amount));

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Pledge")),
            CampaignPledged {
                campaign_id,
                contributor,
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
        if env.ledger().timestamp() < campaign.deadline {
            panic!("campaign is still active");
        }
        if campaign.pledged_amount < campaign.target_amount {
            panic!("campaign is not funded");
        }

        campaign.claimed = true;

        let token_client = TokenClient::new(&env, &campaign.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &creator, &campaign.pledged_amount);

        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Claim")),
            CampaignClaimed {
                campaign_id,
                creator,
                amount: campaign.pledged_amount,
            },
        );
    }

    pub fn refund(env: Env, campaign_id: u64, contributor: Address) {
        contributor.require_auth();

        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if env.ledger().timestamp() < campaign.deadline {
            panic!("campaign is still active");
        }
        if campaign.pledged_amount >= campaign.target_amount {
            panic!("funded campaigns cannot be refunded");
        }

        let key = DataKey::Contribution(campaign_id, contributor.clone());
        let contribution: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if contribution <= 0 {
            panic!("nothing to refund");
        }

        campaign.pledged_amount -= contribution;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
        env.storage().persistent().set(&key, &0_i128);

        let token_client = TokenClient::new(&env, &campaign.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &contributor, &contribution);

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Refund")),
            CampaignRefunded {
                campaign_id,
                contributor,
                amount: contribution,
            },
        );
    }

    pub fn get_campaign(env: Env, campaign_id: u64) -> Campaign {
        read_campaign(&env, campaign_id)
    }

    pub fn get_contribution(env: Env, campaign_id: u64, contributor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Contribution(campaign_id, contributor))
            .unwrap_or(0)
    }

    pub fn get_next_campaign_id(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextCampaignId)
            .unwrap_or(0)
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
