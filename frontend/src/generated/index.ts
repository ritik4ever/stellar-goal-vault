/* eslint-disable */
/**
 * AUTO-GENERATED — do not edit manually
 * Regenerate with: npm run gen:bindings
 * Generated from contract ABI
 * 
 * This file provides type-safe bindings to the Soroban StellarGoalVaultContract.
 * Each function is a typed wrapper around the contract's public API.
 */

import { Contract, rpc, TransactionBuilder, Networks, BASE_FEE, Address, nativeToScVal } from '@stellar/stellar-sdk';

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || '';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

/**
 * Campaign struct from the contract ABI
 */
export interface Campaign {
  creator: string;
  accepted_tokens: string[];
  target_amount: bigint;
  pledged_amount: bigint;
  deadline: number;
  claimed: boolean;
  canceled: boolean;
  metadata: string;
  contributor_count: number;
}

/**
 * Parameters for creating a campaign
 */
export interface CreateCampaignParams {
  creator: string;
  accepted_tokens: string[];
  target_amount: bigint;
  deadline: number;
  metadata: string;
}

/**
 * Typed Soroban contract client for StellarGoalVaultContract
 */
export class GoalVaultContract {
  private contract: Contract;
  private server: rpc.Server;
  private contractId: string;
  private networkPassphrase: string;

  constructor(contractId: string = CONTRACT_ID, rpcUrl: string = RPC_URL, networkPassphrase: string = NETWORK_PASSPHRASE) {
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
    this.contract = new Contract(contractId);
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });
  }

  /**
   * Get the Stellar SDK Contract instance
   */
  getContract(): Contract {
    return this.contract;
  }

  /**
   * Get the RPC Server instance
   */
  getServer(): rpc.Server {
    return this.server;
  }

  /**
   * Get the contract ID
   */
  getContractId(): string {
    return this.contractId;
  }

  /**
   * get_campaign_count() -> u64
   * Returns the total number of campaigns created
   */
  async getCampaignCount(caller: string): Promise<bigint> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call('get_campaign_count')
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_campaign_count');
    }

    return BigInt(result.u64().toString());
  }

  /**
   * get_campaign(campaign_id: u64) -> Campaign
   * Retrieves a campaign by ID
   */
  async getCampaign(caller: string, campaignId: bigint | number): Promise<Campaign> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call('get_campaign', nativeToScVal(BigInt(campaignId), { type: 'u64' }))
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_campaign');
    }

    // Parse the campaign struct from the result
    return parseCampaignFromScVal(result);
  }

  /**
   * get_contribution(campaign_id: u64, contributor: Address, token: Address) -> i128
   * Retrieves the contribution amount for a specific contributor and token
   */
  async getContribution(
    caller: string,
    campaignId: bigint | number,
    contributor: string,
    token: string,
  ): Promise<bigint> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'get_contribution',
          nativeToScVal(BigInt(campaignId), { type: 'u64' }),
          new Address(contributor).toScVal(),
          new Address(token).toScVal(),
        )
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_contribution');
    }

    return BigInt(result.i128().toString());
  }

  /**
   * get_campaign_token_balance(campaign_id: u64, token: Address) -> i128
   * Retrieves the balance of a specific token in a campaign
   */
  async getCampaignTokenBalance(
    caller: string,
    campaignId: bigint | number,
    token: string,
  ): Promise<bigint> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call(
          'get_campaign_token_balance',
          nativeToScVal(BigInt(campaignId), { type: 'u64' }),
          new Address(token).toScVal(),
        )
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_campaign_token_balance');
    }

    return BigInt(result.i128().toString());
  }

  /**
   * get_contributor_count(campaign_id: u64) -> u32
   * Retrieves the number of contributors for a campaign
   */
  async getContributorCount(caller: string, campaignId: bigint | number): Promise<number> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call('get_contributor_count', nativeToScVal(BigInt(campaignId), { type: 'u64' }))
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_contributor_count');
    }

    return Number(result.u32());
  }

  /**
   * get_next_campaign_id(campaign_id: u64) -> u64
   * Retrieves the next available campaign ID
   */
  async getNextCampaignId(caller: string): Promise<bigint> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call('get_next_campaign_id')
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_next_campaign_id');
    }

    return BigInt(result.u64().toString());
  }

  /**
   * get_version() -> String
   * Retrieves the contract version
   */
  async getVersion(caller: string): Promise<string> {
    const sourceAccount = await this.server.getAccount(caller);
    
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        this.contract.call('get_version')
      )
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${JSON.stringify(simulation.error)}`);
    }

    // Extract result from simulation
    const result = simulation.result?.retval;
    if (!result) {
      throw new Error('No result returned from get_version');
    }

    return result.str().toString();
  }
}

/**
 * Helper function to parse a Campaign struct from ScVal
 */
function parseCampaignFromScVal(val: any): Campaign {
  const fields = val.map();
  if (!fields || fields.length === 0) {
    throw new Error('Invalid campaign structure');
  }

  // Parse map entries (Soroban structs are represented as maps)
  const campaign: any = {};
  for (const field of fields) {
    const key = field.key().sym().toString();
    const fieldVal = field.val();
    
    switch (key) {
      case 'creator':
        campaign.creator = fieldVal.address().accountId().toString();
        break;
      case 'target_amount':
        campaign.target_amount = BigInt(fieldVal.i128().toString());
        break;
      case 'pledged_amount':
        campaign.pledged_amount = BigInt(fieldVal.i128().toString());
        break;
      case 'deadline':
        campaign.deadline = fieldVal.u64().toNumber();
        break;
      case 'claimed':
        campaign.claimed = fieldVal.bool();
        break;
      case 'canceled':
        campaign.canceled = fieldVal.bool();
        break;
      case 'metadata':
        campaign.metadata = fieldVal.str().toString();
        break;
      case 'contributor_count':
        campaign.contributor_count = fieldVal.u32().toNumber();
        break;
      case 'accepted_tokens':
        campaign.accepted_tokens = fieldVal.vec().map((token: any) => 
          token.address().accountId().toString()
        );
        break;
    }
  }

  return campaign as Campaign;
}

export default GoalVaultContract;
