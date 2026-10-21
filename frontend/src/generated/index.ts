/* eslint-disable */
/**
 * AUTO-GENERATED — do not edit manually
 * Regenerate with: npm run gen:bindings
 * Generated from contract ABI
 *
 * This file provides type-safe bindings to the Soroban StellarGoalVaultContract.
 * Each function is a typed wrapper around the contract's public API.
 */

import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

/**
 * Soroban `ScVal` accessors.
 *
 * Since stellar-sdk v17 `ScVal` is a discriminated union of variant classes
 * (`ScValU64`, `ScValI128`, ...) that expose their payload as a readonly
 * property instead of the accessor methods used by older releases. These
 * helpers narrow the union and fail loudly when the contract returns an
 * unexpected type.
 *
 * v17 exposes `ScVal` from the `xdr` module; `rpc.Api` no longer re-exports it.
 */
type ScVal = xdr.ScVal;

function unexpectedScVal(context: string, expected: string, actual: ScVal): Error {
  return new Error(`Expected ${expected} for ${context}, received ${actual.type}`);
}

function scValU64(value: ScVal, context: string): bigint {
  if (value.type !== 'scvU64') {
    throw unexpectedScVal(context, 'scvU64', value);
  }
  return scValToNative(value) as bigint;
}

function scValI128(value: ScVal, context: string): bigint {
  if (value.type !== 'scvI128') {
    throw unexpectedScVal(context, 'scvI128', value);
  }
  return scValToNative(value) as bigint;
}

function scValU32(value: ScVal, context: string): number {
  if (value.type !== 'scvU32') {
    throw unexpectedScVal(context, 'scvU32', value);
  }
  return Number(value.u32);
}

function scValString(value: ScVal, context: string): string {
  if (value.type !== 'scvString') {
    throw unexpectedScVal(context, 'scvString', value);
  }
  return String(scValToNative(value));
}

function scValBool(value: ScVal, context: string): boolean {
  if (value.type !== 'scvBool') {
    throw unexpectedScVal(context, 'scvBool', value);
  }
  // stellar-sdk v17 exposes the boolean payload as `b`.
  return Boolean(value.b);
}

function scValAddress(value: ScVal, context: string): string {
  if (value.type !== 'scvAddress') {
    throw unexpectedScVal(context, 'scvAddress', value);
  }
  return Address.fromScAddress(value.address).toString();
}

function scValAddressVec(value: ScVal, context: string): string[] {
  if (value.type !== 'scvVec') {
    throw unexpectedScVal(context, 'scvVec', value);
  }
  return (value.vec ?? []).map((entry) => scValAddress(entry, context));
}

/**
 * Reads a map key. Soroban encodes struct field names as `scvString`, but
 * some contract versions use `scvSymbol`, so both are accepted.
 */
function scValKey(value: ScVal, context: string): string {
  if (value.type === 'scvString' || value.type === 'scvSymbol') {
    return String(scValToNative(value));
  }
  throw unexpectedScVal(context, 'scvString or scvSymbol', value);
}

export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || '';
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

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

  constructor(
    contractId: string = CONTRACT_ID,
    rpcUrl: string = RPC_URL,
    networkPassphrase: string = NETWORK_PASSPHRASE,
  ) {
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
      .addOperation(this.contract.call('get_campaign_count'))
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

    return scValU64(result, 'get_campaign_count');
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
        this.contract.call('get_campaign', nativeToScVal(BigInt(campaignId), { type: 'u64' })),
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
        ),
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

    return scValI128(result, 'get_contribution');
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
        ),
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

    return scValI128(result, 'get_campaign_token_balance');
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
        this.contract.call(
          'get_contributor_count',
          nativeToScVal(BigInt(campaignId), { type: 'u64' }),
        ),
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

    return scValU32(result, 'get_contributor_count');
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
      .addOperation(this.contract.call('get_next_campaign_id'))
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

    return scValU64(result, 'get_next_campaign_id');
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
      .addOperation(this.contract.call('get_version'))
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

    return scValString(result, 'get_version');
  }
}

/**
 * Helper function to parse a Campaign struct from ScVal
 */
function parseCampaignFromScVal(val: ScVal): Campaign {
  if (val.type !== 'scvMap') {
    throw new Error('Invalid campaign structure');
  }

  const fields = val.map ?? [];
  if (fields.length === 0) {
    throw new Error('Invalid campaign structure');
  }

  // Parse map entries (Soroban structs are represented as maps)
  const campaign: Partial<Campaign> = {};
  for (const field of fields) {
    const key = scValKey(field.key, 'campaign field key');
    const fieldVal = field.val;

    switch (key) {
      case 'creator':
        campaign.creator = scValAddress(fieldVal, 'campaign.creator');
        break;
      case 'target_amount':
        campaign.target_amount = scValI128(fieldVal, 'campaign.target_amount');
        break;
      case 'pledged_amount':
        campaign.pledged_amount = scValI128(fieldVal, 'campaign.pledged_amount');
        break;
      case 'deadline':
        campaign.deadline = Number(scValU64(fieldVal, 'campaign.deadline'));
        break;
      case 'claimed':
        campaign.claimed = scValBool(fieldVal, 'campaign.claimed');
        break;
      case 'canceled':
        campaign.canceled = scValBool(fieldVal, 'campaign.canceled');
        break;
      case 'metadata':
        campaign.metadata = scValString(fieldVal, 'campaign.metadata');
        break;
      case 'contributor_count':
        campaign.contributor_count = scValU32(fieldVal, 'campaign.contributor_count');
        break;
      case 'accepted_tokens':
        campaign.accepted_tokens = scValAddressVec(fieldVal, 'campaign.accepted_tokens');
        break;
    }
  }

  return campaign as Campaign;
}

export default GoalVaultContract;
