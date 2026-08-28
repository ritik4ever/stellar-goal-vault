use soroban_sdk::{contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec};
use crate::{DataKey, StellarGoalVaultContract};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposal {
    pub new_wasm_hash: BytesN<32>,
    pub execution_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposedEvent {
    pub new_wasm_hash: BytesN<32>,
    pub execution_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeExecutedEvent {
    pub new_wasm_hash: BytesN<32>,
}

const TIME_LOCK_DURATION_SECONDS: u64 = 48 * 60 * 60; // 48 hours

#[contractimpl]
impl StellarGoalVaultContract {
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"));
        if admin != stored_admin {
            panic!("caller is not admin");
        }

        let execution_time = env.ledger().timestamp() + TIME_LOCK_DURATION_SECONDS;
        let proposal = UpgradeProposal {
            new_wasm_hash: new_wasm_hash.clone(),
            execution_time,
        };

        env.storage().instance().set(&DataKey::UpgradeProposal, &proposal);

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Proposed")),
            UpgradeProposedEvent {
                new_wasm_hash,
                execution_time,
            },
        );
    }

    pub fn execute_upgrade(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("not initialized"));
        if admin != stored_admin {
            panic!("caller is not admin");
        }

        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeProposal)
            .unwrap_or_else(|| panic!("no upgrade proposed"));

        if env.ledger().timestamp() < proposal.execution_time {
            panic!("time-lock has not expired");
        }

        // Execute Wasm upgrade
        env.deployer().update_current_contract_wasm(proposal.new_wasm_hash.clone());

        // Clear proposal
        env.storage().instance().remove(&DataKey::UpgradeProposal);

        // Record history
        let mut history: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(proposal.new_wasm_hash.clone());
        env.storage().instance().set(&DataKey::UpgradeHistory, &history);

        env.events().publish(
            (symbol_short!("Upgrade"), symbol_short!("Executed")),
            UpgradeExecutedEvent {
                new_wasm_hash: proposal.new_wasm_hash,
            },
        );
    }

    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::UpgradeProposal)
    }

    pub fn get_upgrade_history(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&DataKey::UpgradeHistory)
            .unwrap_or_else(|| Vec::new(&env))
    }
}
