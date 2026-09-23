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

    stopEventIndexer();
  });
});
