import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Focused tests for the regenerated Soroban bindings (frontend/src/generated/index.ts).
 *
 * These cover the ABI surface of `contribute` (pledge) and `refund` — the two
 * functions whose arguments change when the contract ABI evolves — along with
 * the client-side validation that must run BEFORE a transaction is simulated
 * or signed. All network I/O is mocked; no live funds or accounts are used.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mock setup
// ─────────────────────────────────────────────────────────────────────────────

const mockCall = vi.fn();
const mockAddOperation = vi.fn().mockReturnThis();
const mockSetTimeout = vi.fn().mockReturnThis();
const mockBuild = vi.fn().mockReturnValue({ xdr: 'mock-tx-xdr', fee: '100' });
const mockSimulateTransaction = vi.fn();
const mockGetAccount = vi.fn().mockResolvedValue({ account_id: 'GTEST', sequence: '1' });

vi.mock('@stellar/stellar-sdk', () => ({
  Contract: vi.fn().mockImplementation(() => ({ call: mockCall })),
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    addOperation: mockAddOperation,
    setTimeout: mockSetTimeout,
    build: mockBuild,
  })),
  Address: vi.fn().mockImplementation((value: string) => ({
    toScVal: () => ({ kind: 'address', value }),
  })),
  nativeToScVal: vi.fn((value: unknown, opts?: { type?: string }) => ({
    value,
    type: opts?.type ?? 'unknown',
  })),
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  BASE_FEE: '100',
  Transaction: class {},
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getAccount: mockGetAccount,
      simulateTransaction: mockSimulateTransaction,
    })),
    Api: {
      isSimulationError: vi.fn(() => false),
    },
  },
}));

import { GoalVaultContract, type ContributeParams, type RefundParams } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_ADDR = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const CONTRIBUTOR = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4';
const TOKEN_ADDR = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWKZFY';

function makeClient(): GoalVaultContract {
  return new GoalVaultContract(
    CONTRACT_ADDR,
    'https://soroban-testnet.stellar.org',
    'Test SDF Network ; September 2015',
  );
}

const baseContribute: ContributeParams = {
  campaignId: 1n,
  contributor: CONTRIBUTOR,
  token: TOKEN_ADDR,
  amount: 100_0000000n,
};

const baseRefund: RefundParams = {
  campaignId: 1n,
  contributor: CONTRIBUTOR,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GoalVaultContract — contribute ABI binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
  });

  it('calls the contract with the correct operation name "contribute"', async () => {
    await makeClient().buildContributeTransaction(baseContribute);
    expect(mockCall).toHaveBeenCalledWith(
      'contribute',
      expect.objectContaining({ type: 'u64' }),  // campaign_id
      expect.anything(),                          // contributor address
      expect.anything(),                          // token address
      expect.objectContaining({ type: 'i128' }),  // amount
    );
  });

  it('encodes campaign_id as u64', async () => {
    await makeClient().buildContributeTransaction(baseContribute);
    const [, campaignIdArg] = mockCall.mock.calls[0];
    expect(campaignIdArg).toMatchObject({ type: 'u64' });
  });

  it('encodes amount as i128', async () => {
    await makeClient().buildContributeTransaction(baseContribute);
    const [, , , , amountArg] = mockCall.mock.calls[0];
    expect(amountArg).toMatchObject({ type: 'i128' });
  });

  it('rejects an empty contributor BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({ ...baseContribute, contributor: '' }),
    ).rejects.toThrow(/contributor address is required/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only contributor BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({ ...baseContribute, contributor: '   ' }),
    ).rejects.toThrow(/contributor address is required/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects an empty token BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({ ...baseContribute, token: '' }),
    ).rejects.toThrow(/token address is required/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects amount = 0n BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({ ...baseContribute, amount: 0n }),
    ).rejects.toThrow(/amount must be a positive i128/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects negative amount BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({
        ...baseContribute,
        amount: BigInt(-1),
      }),
    ).rejects.toThrow(/amount must be a positive i128/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects the vault contract address as contributor BEFORE simulating', async () => {
    await expect(
      makeClient().buildContributeTransaction({
        ...baseContribute,
        contributor: CONTRACT_ADDR,
      }),
    ).rejects.toThrow(/contributor cannot be the vault contract/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('propagates simulation errors', async () => {
    // Re-import rpc mock to access isSimulationError
    const { rpc } = await import('@stellar/stellar-sdk');
    vi.mocked(rpc.Api.isSimulationError).mockReturnValueOnce(true);
    mockSimulateTransaction.mockResolvedValueOnce({ error: 'contract panic' });

    await expect(
      makeClient().buildContributeTransaction(baseContribute),
    ).rejects.toThrow(/simulation failed/i);
  });
});

describe('GoalVaultContract — refund ABI binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
  });

  it('calls the contract with the correct operation name "refund"', async () => {
    await makeClient().buildRefundTransaction(baseRefund);
    expect(mockCall).toHaveBeenCalledWith(
      'refund',
      expect.objectContaining({ type: 'u64' }),  // campaign_id
      expect.anything(),                          // contributor address
    );
  });

  it('encodes campaign_id as u64', async () => {
    await makeClient().buildRefundTransaction(baseRefund);
    const [, campaignIdArg] = mockCall.mock.calls[0];
    expect(campaignIdArg).toMatchObject({ type: 'u64' });
  });

  it('rejects an empty contributor BEFORE simulating', async () => {
    await expect(
      makeClient().buildRefundTransaction({ ...baseRefund, contributor: '' }),
    ).rejects.toThrow(/contributor address is required/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a negative campaign ID BEFORE simulating', async () => {
    await expect(
      makeClient().buildRefundTransaction({ ...baseRefund, campaignId: BigInt(-1) }),
    ).rejects.toThrow(/campaign ID must be a non-negative integer/i);
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('propagates simulation errors', async () => {
    const { rpc } = await import('@stellar/stellar-sdk');
    vi.mocked(rpc.Api.isSimulationError).mockReturnValueOnce(true);
    mockSimulateTransaction.mockResolvedValueOnce({ error: 'contract refund panic' });

    await expect(
      makeClient().buildRefundTransaction(baseRefund),
    ).rejects.toThrow(/simulation failed/i);
  });
});

describe('GoalVaultContract — ABI surface contract', () => {
  it('exposes buildContributeTransaction', () => {
    expect(typeof makeClient().buildContributeTransaction).toBe('function');
  });

  it('exposes buildRefundTransaction', () => {
    expect(typeof makeClient().buildRefundTransaction).toBe('function');
  });

  it('still exposes pre-existing read-only methods', () => {
    const c = makeClient();
    expect(typeof c.getCampaignCount).toBe('function');
    expect(typeof c.getCampaign).toBe('function');
    expect(typeof c.getContribution).toBe('function');
    expect(typeof c.getCampaignTokenBalance).toBe('function');
    expect(typeof c.getContributorCount).toBe('function');
    expect(typeof c.getNextCampaignId).toBe('function');
    expect(typeof c.getVersion).toBe('function');
  });
});
