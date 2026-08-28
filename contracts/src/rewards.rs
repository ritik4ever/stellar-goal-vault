#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardTiers {
    pub bronze: i128,
    pub silver: i128,
    pub gold: i128,
}

#[contracttype]
pub enum BadgeDataKey {
    Admin,
    Tier(Address),
}

#[contract]
pub struct BadgeContract;

#[contractimpl]
impl BadgeContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&BadgeDataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&BadgeDataKey::Admin, &admin);
    }

    pub fn mint(env: Env, to: Address, tier: u32) {
        let admin: Address = env.storage().instance().get(&BadgeDataKey::Admin).unwrap();
        admin.require_auth();

        // tier: 1=Bronze, 2=Silver, 3=Gold
        let current_tier: u32 = env
            .storage()
            .persistent()
            .get(&BadgeDataKey::Tier(to.clone()))
            .unwrap_or(0);
        if tier > current_tier {
            env.storage()
                .persistent()
                .set(&BadgeDataKey::Tier(to), &tier);
        }
    }

    pub fn get_tier(env: Env, user: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&BadgeDataKey::Tier(user))
            .unwrap_or(0)
    }
}
