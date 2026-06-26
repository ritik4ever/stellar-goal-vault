#![no_std]



use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    String, Vec,
};

const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Default minimum contribution in stroops (100). Overridable via initialize().
const MIN_CONTRIBUTION: i128 = 100;

/// Maximum number of distinct tokens a campaign can accept.
/// This prevents unbounded Vec storage growth attacks where an adversary
/// creates a campaign with thousands of token addresses, inflating the
/// ledger entry size and forcing other validators to pay higher fees for
/// processing oversized entries. A limit of 10 is sufficient for realistic
/// multi-token donation campaigns while keeping storage costs predictable.
const MAX_ACCEPTED_TOKENS: u32 = 10;

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
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    NextCampaignId,
    ContractVersion,
    DeploymentTimestamp,
    Campaign(u64),
    Contribution(u64, Address, Address), // (campaign_id, contributor, token)
    CampaignTokenBalance(u64, Address),  // (campaign_id, token)
    /// Maximum total contribution any single contributor may make to a
    /// campaign across all tokens. Absent (or zero) means no cap.
    ContributorCap(u64),               // campaign_id → i128
    Admin,
    Paused,
    MinContribution,
    ExtensionRequest(u64),
    ExtensionVote(u64, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeployInfo {
    pub version: String,
    pub deployed_at: u64,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPaused {
    pub contract_version: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUnpaused {
    pub contract_version: String,
}

/// Emitted when a campaign creator updates the campaign metadata (issue #185).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataUpdated {
    pub campaign_id: u64,
    pub creator: Address,
    pub old_metadata: String,
    pub new_metadata: String,
}

/// Stored when a contributor requests a deadline extension (issue #192).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionRequest {
    pub new_deadline: u64,
    pub requested_by: Address,
    pub approval_count: u32,
}

/// Emitted when a deadline extension is requested (issue #192).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExtensionRequested {
    pub campaign_id: u64,
    pub requested_by: Address,
    pub new_deadline: u64,
}

#[contract]
pub struct StellarGoalVaultContract;

const MAX_CAMPAIGN_DURATION_SECONDS: u64 = 60 * 60 * 24 * 180;

#[contractimpl]
impl StellarGoalVaultContract {
    /// Sets the admin address and the minimum contribution floor (in stroops).
    /// Panics if already initialized or min_contribution is not positive.
    pub fn initialize(env: Env, admin: Address, min_contribution: i128) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if min_contribution <= 0 {
            panic!("min_contribution must be positive");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::MinContribution, &min_contribution);
    }

    /// Returns the current minimum contribution threshold in stroops.
    /// Falls back to the compile-time default (100) if initialize() was not called.
    pub fn get_min_contribution(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinContribution)
            .unwrap_or(MIN_CONTRIBUTION)
    }

    /// Pauses or unpauses all state-mutating entry points. Admin only.
    pub fn set_paused(env: Env, caller: Address, paused: bool) {
        caller.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"));
        if caller != admin {
            panic!("caller is not admin");
        }
        env.storage().instance().set(&DataKey::Paused, &paused);
        let version = String::from_str(&env, CONTRACT_VERSION);
        if paused {
            env.events().publish(
                (symbol_short!("Goal"), symbol_short!("Pause")),
                ContractPaused { contract_version: version },
            );
        } else {
            env.events().publish(
                (symbol_short!("Goal"), symbol_short!("Unpause")),
                ContractUnpaused { contract_version: version },
            );
        }
    }

    pub fn get_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"))
    }

    /// Creator can cancel an active campaign, allowing contributors to refund.
    pub fn cancel_campaign(env: Env, campaign_id: u64, creator: Address) {
        require_not_paused(&env);
        creator.require_auth();
        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.creator != creator {
            panic!("creator mismatch");
        }
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if campaign.canceled {
            panic!("campaign already canceled");
        }
        campaign.canceled = true;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("Cancel")),
            CampaignCanceled { campaign_id, creator },
        );
    }

    pub fn create_campaign(
        env: Env,
        creator: Address,
        accepted_tokens: Vec<Address>,
        target_amount: i128,
        deadline: u64,
        metadata: String,
        max_per_contributor: i128,
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
            panic!("accepted_tokens must not be empty");
        }

        let mut i = 0;
        while i < accepted_tokens.len() {
            let mut j = i + 1;
            while j < accepted_tokens.len() {
                if accepted_tokens.get(i).unwrap() == accepted_tokens.get(j).unwrap() {
                    panic!("duplicate token addresses");
                }
                j += 1;
            }
            i += 1;
        }
        if accepted_tokens.len() > MAX_ACCEPTED_TOKENS {
            panic!("too many accepted tokens");
        }
        if max_per_contributor < 0 {
            panic!("max_per_contributor must not be negative");
        }

        let mut next_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextCampaignId)
            .unwrap_or(0);
        next_id += 1;

        let created_at = env.ledger().timestamp();

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
            created_at,
        };

        env.storage()
            .persistent()
            .set(&DataKey::NextCampaignId, &next_id);
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(next_id), &campaign);

        // Store the per-contributor cap only when a positive limit is set.
        // Absent key is equivalent to cap == 0 (no limit).
        if max_per_contributor > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::ContributorCap(next_id), &max_per_contributor);
        }

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
        require_not_paused(&env);
        contributor.require_auth();

        let min_contribution: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinContribution)
            .unwrap_or(MIN_CONTRIBUTION);
        if amount < min_contribution {
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

    /// Updates the campaign metadata. Only the original creator can call this,
    /// and only before the campaign deadline. Emits a MetadataUpdated event
    /// containing both old and new values (issue #185).
    pub fn update_metadata(env: Env, campaign_id: u64, creator: Address, new_metadata: String) {
        require_not_paused(&env);
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
        if env.ledger().timestamp() >= campaign.deadline {
            panic!("campaign deadline reached");
        }
        let old_metadata = campaign.metadata.clone();
        campaign.metadata = new_metadata.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);
        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("MetaUpd")),
            MetadataUpdated {
                campaign_id,
                creator,
                old_metadata,
                new_metadata,
            },
        );
    }

    /// Requests a deadline extension for a campaign. The caller must be an
    /// existing contributor. The requester auto-approves their own request.
    /// new_deadline must be later than the current deadline and within
    /// MAX_CAMPAIGN_DURATION_SECONDS of the campaign's creation (issue #192).
    pub fn request_deadline_extension(
        env: Env,
        campaign_id: u64,
        caller: Address,
        new_deadline: u64,
    ) {
        require_not_paused(&env);
        caller.require_auth();
        let campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if campaign.canceled {
            panic!("campaign canceled");
        }
        if new_deadline <= campaign.deadline {
            panic!("new deadline must be after current deadline");
        }
        if new_deadline > campaign.created_at + MAX_CAMPAIGN_DURATION_SECONDS {
            panic!("new deadline exceeds maximum campaign duration");
        }

        // Caller must be a contributor
        let is_contributor = campaign.accepted_tokens.iter().any(|token| {
            let key = DataKey::Contribution(campaign_id, caller.clone(), token.clone());
            let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            amount > 0
        });
        if !is_contributor {
            panic!("caller is not a contributor");
        }

        let request = ExtensionRequest {
            new_deadline,
            requested_by: caller.clone(),
            approval_count: 1, // requester auto-approves
        };
        env.storage()
            .persistent()
            .set(&DataKey::ExtensionRequest(campaign_id), &request);
        // Mark requester as having voted
        env.storage()
            .persistent()
            .set(&DataKey::ExtensionVote(campaign_id, caller.clone()), &true);

        env.events().publish(
            (symbol_short!("Goal"), symbol_short!("ExtReq")),
            ExtensionRequested {
                campaign_id,
                requested_by: caller,
                new_deadline,
            },
        );
    }

    /// Votes to approve a pending deadline extension. The caller must be an
    /// existing contributor and must not have already voted. When approvals
    /// exceed 50% of the contributor count, the new deadline is applied and
    /// the pending request is cleared (issue #192).
    pub fn approve_extension(env: Env, campaign_id: u64, caller: Address) {
        require_not_paused(&env);
        caller.require_auth();
        let mut campaign = read_campaign(&env, campaign_id);
        if campaign.claimed {
            panic!("campaign already claimed");
        }
        if campaign.canceled {
            panic!("campaign canceled");
        }

        // Caller must be a contributor
        let is_contributor = campaign.accepted_tokens.iter().any(|token| {
            let key = DataKey::Contribution(campaign_id, caller.clone(), token.clone());
            let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
            amount > 0
        });
        if !is_contributor {
            panic!("caller is not a contributor");
        }

        let vote_key = DataKey::ExtensionVote(campaign_id, caller.clone());
        let already_voted: bool = env.storage().persistent().get(&vote_key).unwrap_or(false);
        if already_voted {
            panic!("already voted");
        }

        let request_key = DataKey::ExtensionRequest(campaign_id);
        let mut request: ExtensionRequest = env
            .storage()
            .persistent()
            .get(&request_key)
            .unwrap_or_else(|| panic!("no extension request"));

        env.storage().persistent().set(&vote_key, &true);
        request.approval_count += 1;

        // Majority threshold: approval_count * 2 > contributor_count
        if campaign.contributor_count > 0 && request.approval_count * 2 > campaign.contributor_count {
            campaign.deadline = request.new_deadline;
            env.storage()
                .persistent()
                .set(&DataKey::Campaign(campaign_id), &campaign);
            env.storage().persistent().remove(&request_key);
        } else {
            env.storage().persistent().set(&request_key, &request);
        }
    }

    /// Returns the pending extension request for a campaign, if one exists.
    pub fn get_extension_request(env: Env, campaign_id: u64) -> Option<ExtensionRequest> {
        env.storage()
            .persistent()
            .get(&DataKey::ExtensionRequest(campaign_id))
    }

    pub fn claim(env: Env, campaign_id: u64, creator: Address) {
        require_not_paused(&env);
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
        require_not_paused(&env);
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

    pub fn get_deploy_info(env: Env) -> DeployInfo {
        let version = Self::get_version(env.clone());
        let deployed_at: u64 = match env.storage().instance().get(&DataKey::DeploymentTimestamp) {
            Some(ts) => ts,
            None => {
                let ts = env.ledger().timestamp();
                env.storage().instance().set(&DataKey::DeploymentTimestamp, &ts);
                ts
            }
        };
        DeployInfo {
            version,
            deployed_at,
        }
    }
}

fn require_not_paused(env: &Env) {
    if env
        .storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
    {
        panic!("contract is paused");
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
