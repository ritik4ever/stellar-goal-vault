#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env, IntoVal,
};

const VOTING_PERIOD_SECONDS: u64 = 7 * 24 * 60 * 60; // 7 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Parameter {
    MinCampaignTarget(i128),
    FeeRate(i128),
    Admin(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub parameter: Parameter,
    pub start_time: u64,
    pub end_time: u64,
    pub for_votes: i128,
    pub against_votes: i128,
    pub executed: bool,
}

#[contracttype]
pub enum DaoDataKey {
    GovToken,
    NextProposalId,
    Proposal(u64),
    Vote(u64, Address),
    TotalSupply,
    TargetContract,
}

#[contract]
pub struct DaoContract;

#[contractimpl]
impl DaoContract {
    pub fn initialize(env: Env, gov_token: Address, target_contract: Address, total_supply: i128) {
        if env.storage().instance().has(&DaoDataKey::GovToken) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DaoDataKey::GovToken, &gov_token);
        env.storage().instance().set(&DaoDataKey::TargetContract, &target_contract);
        env.storage().instance().set(&DaoDataKey::TotalSupply, &total_supply);
    }

    pub fn create_proposal(env: Env, proposer: Address, parameter: Parameter) -> u64 {
        proposer.require_auth();

        let mut next_id: u64 = env.storage().instance().get(&DaoDataKey::NextProposalId).unwrap_or(0);
        next_id += 1;

        let start_time = env.ledger().timestamp();
        let end_time = start_time + VOTING_PERIOD_SECONDS;

        let proposal = Proposal {
            id: next_id,
            proposer: proposer.clone(),
            parameter,
            start_time,
            end_time,
            for_votes: 0,
            against_votes: 0,
            executed: false,
        };

        env.storage().instance().set(&DaoDataKey::NextProposalId, &next_id);
        env.storage().instance().set(&DaoDataKey::Proposal(next_id), &proposal);

        env.events().publish((soroban_sdk::Symbol::new(&env, "DAO"), soroban_sdk::Symbol::new(&env, "ProposalCreated")), next_id);

        next_id
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool, amount: i128) {
        voter.require_auth();

        if amount <= 0 {
            panic!("vote amount must be positive");
        }

        let mut proposal: Proposal = env.storage().instance().get(&DaoDataKey::Proposal(proposal_id)).unwrap_or_else(|| panic!("proposal not found"));
        if env.ledger().timestamp() > proposal.end_time {
            panic!("voting period ended");
        }

        let vote_key = DaoDataKey::Vote(proposal_id, voter.clone());
        if env.storage().instance().has(&vote_key) {
            panic!("already voted");
        }

        let gov_token: Address = env.storage().instance().get(&DaoDataKey::GovToken).unwrap();
        let token_client = TokenClient::new(&env, &gov_token);
        let balance = token_client.balance(&voter);
        if balance < amount {
            panic!("insufficient balance");
        }

        if support {
            proposal.for_votes += amount;
        } else {
            proposal.against_votes += amount;
        }

        env.storage().instance().set(&vote_key, &amount);
        env.storage().instance().set(&DaoDataKey::Proposal(proposal_id), &proposal);

        env.events().publish((soroban_sdk::Symbol::new(&env, "DAO"), soroban_sdk::Symbol::new(&env, "VoteCast")), (proposal_id, voter, support, amount));
    }

    pub fn execute(env: Env, caller: Address, proposal_id: u64) {
        caller.require_auth();

        let mut proposal: Proposal = env.storage().instance().get(&DaoDataKey::Proposal(proposal_id)).unwrap_or_else(|| panic!("proposal not found"));
        if env.ledger().timestamp() <= proposal.end_time {
            panic!("voting period not ended");
        }
        if proposal.executed {
            panic!("already executed");
        }

        let total_supply: i128 = env.storage().instance().get(&DaoDataKey::TotalSupply).unwrap();
        let total_votes = proposal.for_votes + proposal.against_votes;
        
        // Quorum check: min 10% token supply must vote
        if total_votes * 10 < total_supply {
            panic!("quorum not reached");
        }

        // Simple majority required
        if proposal.for_votes <= proposal.against_votes {
            panic!("proposal rejected");
        }

        // Execute the parameter change on the target contract
        let target_contract: Address = env.storage().instance().get(&DaoDataKey::TargetContract).unwrap();

        match &proposal.parameter {
            Parameter::MinCampaignTarget(val) => {
                let mut args = soroban_sdk::Vec::new(&env);
                args.push_back(env.current_contract_address().into_val(&env));
                args.push_back(val.into_val(&env));
                env.invoke_contract::<()>(&target_contract, &soroban_sdk::Symbol::new(&env, "set_min_campaign_target"), args);
            },
            Parameter::FeeRate(val) => {
                let mut args = soroban_sdk::Vec::new(&env);
                args.push_back(env.current_contract_address().into_val(&env));
                args.push_back(val.into_val(&env));
                env.invoke_contract::<()>(&target_contract, &soroban_sdk::Symbol::new(&env, "set_fee"), args);
            },
            Parameter::Admin(val) => {
                let mut args = soroban_sdk::Vec::new(&env);
                args.push_back(env.current_contract_address().into_val(&env));
                args.push_back(val.into_val(&env));
                env.invoke_contract::<()>(&target_contract, &soroban_sdk::Symbol::new(&env, "set_admin"), args);
            },
        }

        proposal.executed = true;
        env.storage().instance().set(&DaoDataKey::Proposal(proposal_id), &proposal);

        env.events().publish((soroban_sdk::Symbol::new(&env, "DAO"), soroban_sdk::Symbol::new(&env, "ProposalExecuted")), proposal_id);
    }
}
