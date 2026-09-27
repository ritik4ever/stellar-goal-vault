import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDb, resetDbForTests } from '../db';

const logInfoMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock('../../logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../logger')>();

  return {
    ...actual,
    logInfo: logInfoMock,
    logError: logErrorMock,
  };
});

describe('eventIndexer observability', () => {
  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    process.env.CONTRACT_ID = 'test-contract-id';

    resetDbForTests();
    initDb();

    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { stopEventIndexer } = await import('../eventIndexer');

    stopEventIndexer();
    vi.useRealTimers();

    resetDbForTests();
    vi.clearAllMocks();

    delete process.env.CONTRACT_ID;
  });

  it('emits structured fields when the indexer starts', async () => {
    const { startEventIndexer, stopEventIndexer } =
      await import('../eventIndexer');

    startEventIndexer();

    expect(logInfoMock).toHaveBeenCalledWith(
      'soroban_event_indexer_started',
      expect.objectContaining({
        message: expect.stringContaining('Soroban event indexer started'),
        pollIntervalSeconds: expect.any(Number),
        resumingFromLedger: expect.any(Number),
        contractId: 'test-contract-id',
      }),
      expect.any(String),
    );

    stopEventIndexer();
  });

  it('reports healthy indexer status with structured fields', async () => {
    const { getIndexerStatus } = await import('../eventIndexer');

    const status = getIndexerStatus();

    expect(status).toEqual(
      expect.objectContaining({
        lastSuccessfulPollTime: null,
        lastKnownLedger: expect.any(Number),
        isHealthy: false,
        consecutiveFailures: 0,
        lagMs: null,
        freshness: 'never',
        staleLagMs: expect.any(Number),
        freshLagMs: expect.any(Number),
      }),
    );
  });

  it('exposes failure observability fields when an RPC poll fails', async () => {
    vi.useFakeTimers();

    const axios = await import('axios');

    vi.spyOn(axios.default, 'post').mockRejectedValue(
      new Error('RPC unavailable'),
    );

    const { startEventIndexer, stopEventIndexer, getIndexerStatus } =
      await import('../eventIndexer');

    startEventIndexer();

    await vi.runOnlyPendingTimersAsync();

    expect(logErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        event: 'soroban_event_index_error',
        consecutiveFailures: expect.any(Number),
        nextRetryMs: expect.any(Number),
        reason: 'RPC unavailable',
      }),
      expect.any(String),
    );

    expect(logInfoMock).toHaveBeenCalledWith(
      'soroban_indexer_backoff',
      expect.objectContaining({
        message: expect.stringContaining('RPC failure'),
        backoffMs: expect.any(Number),
      }),
      expect.any(String),
    );

    const status = getIndexerStatus();

    expect(status.consecutiveFailures).toBeGreaterThanOrEqual(1);
    expect(status.isHealthy).toBe(false);

    // Simulate recovery
    vi.spyOn(axios.default, 'post').mockResolvedValueOnce({
      data: { result: { latestLedger: 100, events: [] } },
    });
    await vi.runOnlyPendingTimersAsync();

    expect(logInfoMock).toHaveBeenCalledWith(
      'soroban_indexer_recovery',
      expect.objectContaining({
        message: expect.stringContaining('Indexer recovered'),
        retryCount: expect.any(Number),
        outcome: 'success',
        lastErrorReason: expect.any(String),
      }),
      expect.any(String),
    );

    stopEventIndexer();
  });
});

  it('classifies freshness: failing / never / fresh / idle / stale', async () => {
    const { classifyIndexerFreshness } = await import('../eventIndexer');

    expect(
      classifyIndexerFreshness({ consecutiveFailures: 2, lagMs: 1000, running: true }),
    ).toBe('failing');
    expect(
      classifyIndexerFreshness({ consecutiveFailures: 0, lagMs: null, running: false }),
    ).toBe('never');
    expect(
      classifyIndexerFreshness({ consecutiveFailures: 0, lagMs: 1_000, running: true }),
    ).toBe('fresh');
    expect(
      classifyIndexerFreshness({ consecutiveFailures: 0, lagMs: 60_000, running: true }),
    ).toBe('idle');
    expect(
      classifyIndexerFreshness({ consecutiveFailures: 0, lagMs: 10 * 60_000, running: true }),
    ).toBe('stale');
  });
