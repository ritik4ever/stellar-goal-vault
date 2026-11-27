import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockContractCall, mockGetAccount, mockSimulateTransaction, mockIsSimulationError } =
  vi.hoisted(() => ({
    mockContractCall: vi.fn((method: string, ...args: unknown[]) => ({ method, args })),
    mockGetAccount: vi.fn(),
    mockSimulateTransaction: vi.fn(),
    mockIsSimulationError: vi.fn(() => false),
  }));

vi.mock('@stellar/stellar-sdk', () => {
  class MockContract {
    public readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
    call = mockContractCall;
  }

  class MockServer {
    public readonly rpcUrl: string;
    constructor(rpcUrl: string) {
      this.rpcUrl = rpcUrl;
    }
    getAccount = mockGetAccount;
    simulateTransaction = mockSimulateTransaction;
  }

  class MockTransactionBuilder {
    private ops: unknown[] = [];
    addOperation(op: unknown) {
      this.ops.push(op);
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { ops: this.ops };
    }
  }

  class MockAddress {
    public readonly value: string;
    constructor(value: string) {
      this.value = value;
    }
    toScVal() {
      return { scValType: 'address', value: this.value };
    }
  }

  return {
    Contract: MockContract,
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationError: mockIsSimulationError,
      },
    },
    TransactionBuilder: MockTransactionBuilder,
    Networks: { TESTNET: 'Test SDF Network ; September 2015' },
    BASE_FEE: '100',
    Address: MockAddress,
    nativeToScVal: (value: unknown, opts?: { type?: string }) => ({
      scValType: opts?.type ?? 'unknown',
      value,
    }),
  };
});

import GoalVaultContract, { type Campaign } from './index';

// Deterministic synthetic non-live identifiers (never funded, no network calls).
const DEPLOYED_CONTRACT_ID = `C${'D'.repeat(55)}`;
const CALLER_ADDRESS = `G${'A'.repeat(55)}`;
const CONTRIBUTOR_ADDRESS = `G${'B'.repeat(55)}`;
const TOKEN_ADDRESS = `C${'T'.repeat(55)}`;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

function makeMapEntry(key: string, val: unknown) {
  return {
    key: () => ({ sym: () => ({ toString: () => key }) }),
    val: () => val,
  };
}

describe('GoalVaultContract generated bindings (type-safe calls, no live funds)', () => {
  let client: GoalVaultContract;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccount.mockResolvedValue({ accountId: CALLER_ADDRESS, sequence: '1' });
    mockIsSimulationError.mockReturnValue(false);
    client = new GoalVaultContract(DEPLOYED_CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE);
  });

  it('exposes the configured contract ID without touching live networks', () => {
    expect(client.getContractId()).toBe(DEPLOYED_CONTRACT_ID);
    expect(mockGetAccount).not.toHaveBeenCalled();
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('executes a type-safe getContribution call with u64 and Address ScVal args', async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          i128: () => ({ toString: () => '250000000' }),
        },
      },
    });

    const amount: bigint = await client.getContribution(
      CALLER_ADDRESS,
      42n,
      CONTRIBUTOR_ADDRESS,
      TOKEN_ADDRESS,
    );

    expect(amount).toBe(250000000n);
    expect(mockContractCall).toHaveBeenCalledWith(
      'get_contribution',
      { scValType: 'u64', value: 42n },
      { scValType: 'address', value: CONTRIBUTOR_ADDRESS },
      { scValType: 'address', value: TOKEN_ADDRESS },
    );
  });

  it('executes a type-safe getCampaign call and parses Campaign struct fields', async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          map: () => [
            makeMapEntry('creator', {
              address: () => ({ accountId: () => ({ toString: () => CALLER_ADDRESS }) }),
            }),
            makeMapEntry('target_amount', { i128: () => ({ toString: () => '1000000000' }) }),
            makeMapEntry('pledged_amount', { i128: () => ({ toString: () => '500000000' }) }),
            makeMapEntry('deadline', { u64: () => ({ toNumber: () => 1800000000 }) }),
            makeMapEntry('claimed', { bool: () => false }),
            makeMapEntry('canceled', { bool: () => false }),
            makeMapEntry('metadata', { str: () => ({ toString: () => 'Clean Water Vault' }) }),
            makeMapEntry('contributor_count', { u32: () => ({ toNumber: () => 3 }) }),
            makeMapEntry('accepted_tokens', {
              vec: () => [
                {
                  address: () => ({ accountId: () => ({ toString: () => TOKEN_ADDRESS }) }),
                },
              ],
            }),
          ],
        },
      },
    });

    const campaign: Campaign = await client.getCampaign(CALLER_ADDRESS, 7);

    expect(campaign).toEqual({
      creator: CALLER_ADDRESS,
      accepted_tokens: [TOKEN_ADDRESS],
      target_amount: 1000000000n,
      pledged_amount: 500000000n,
      deadline: 1800000000,
      claimed: false,
      canceled: false,
      metadata: 'Clean Water Vault',
      contributor_count: 3,
    });
    expect(mockContractCall).toHaveBeenCalledWith('get_campaign', {
      scValType: 'u64',
      value: 7n,
    });
  });

  it('executes type-safe read calls for count, token balance, contributor count, next ID, and version', async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce({ result: { retval: { u64: () => ({ toString: () => '5' }) } } })
      .mockResolvedValueOnce({ result: { retval: { i128: () => ({ toString: () => '9000' }) } } })
      .mockResolvedValueOnce({ result: { retval: { u32: () => 12 } } })
      .mockResolvedValueOnce({ result: { retval: { u64: () => ({ toString: () => '6' }) } } })
      .mockResolvedValueOnce({ result: { retval: { str: () => ({ toString: () => '1.0.0' }) } } });

    expect(await client.getCampaignCount(CALLER_ADDRESS)).toBe(5n);
    expect(await client.getCampaignTokenBalance(CALLER_ADDRESS, 1, TOKEN_ADDRESS)).toBe(9000n);
    expect(await client.getContributorCount(CALLER_ADDRESS, 1)).toBe(12);
    expect(await client.getNextCampaignId(CALLER_ADDRESS)).toBe(6n);
    expect(await client.getVersion(CALLER_ADDRESS)).toBe('1.0.0');
  });

  it('surfaces simulation errors instead of returning silently', async () => {
    mockIsSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ error: 'HostError: InvalidAction' });

    await expect(
      client.getContribution(CALLER_ADDRESS, 1, CONTRIBUTOR_ADDRESS, TOKEN_ADDRESS),
    ).rejects.toThrow(/Simulation failed/);
  });
});
