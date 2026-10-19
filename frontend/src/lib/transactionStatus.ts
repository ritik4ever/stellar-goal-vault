/**
 * Deterministic lifecycle tracking for wallet-signed Soroban transactions.
 *
 * Every user-initiated on-chain action (pledge, claim, refund) is identified by
 * a logical action key. The tracker guarantees that:
 *   - repeated triggers while an action is pending are ignored, and
 *   - retries never build a second transaction for the same logical action:
 *     an already-submitted transaction is resumed by hash, and an already
 *     confirmed transaction is only re-recorded with the backend.
 */

export type TransactionStatus = 'idle' | 'pending' | 'confirmed' | 'failed' | 'retryable';

export interface TransactionState<TResult> {
  status: TransactionStatus;
  /**
   * Opaque handle (the signed envelope) of a transaction that was handed to the
   * network but not confirmed. Present only for `retryable`; a retry resumes it
   * instead of building a new transaction.
   */
  submittedTransaction?: string;
  /** On-chain result kept when the chain confirmed but backend recording failed. */
  result?: TResult;
  error?: unknown;
}

type CodedError = { code?: string; resultCode?: string; submittedTransaction?: string };

/** Error codes for conditions that are expected to clear on their own. */
const RETRYABLE_ERROR_CODES = new Set([
  'SUBMISSION_RETRY',
  'TRANSACTION_TIMEOUT',
  'TRANSACTION_EXPIRED',
  'SOURCE_ACCOUNT_LOAD_FAILED',
  'RPC_UNAVAILABLE',
]);

/**
 * Stellar transaction result codes (from a rejected submission) that can be
 * resolved by submitting again. Rejected transactions never reach the ledger,
 * so rebuilding is safe for these. Everything else (txBadSeq,
 * txInsufficientBalance, txFailed, ...) is a permanent failure.
 */
const RETRYABLE_RESULT_CODES = new Set(['txInsufficientFee', 'txTooLate']);

function asCoded(error: unknown): CodedError {
  return error && typeof error === 'object' ? (error as CodedError) : {};
}

/** Maps a submission error to a terminal status. Same input → same output. */
export function classifyTransactionError(error: unknown): 'failed' | 'retryable' {
  const { code, resultCode } = asCoded(error);
  // A rejected submission carries the Stellar result code whatever its app code.
  if (code === 'TRANSACTION_REJECTED' || resultCode !== undefined) {
    return resultCode && RETRYABLE_RESULT_CODES.has(resultCode) ? 'retryable' : 'failed';
  }
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return 'retryable';
  }
  return 'failed';
}

export interface TransactionActionSteps<TResult> {
  /** Builds, signs, submits, and confirms a new transaction. */
  submit: () => Promise<TResult>;
  /** Resumes an already-submitted transaction (same envelope) until it confirms. */
  resume: (submittedTransaction: string) => Promise<TResult>;
  /** Records the confirmed transaction with the backend (idempotent by tx hash). */
  record?: (result: TResult) => Promise<void>;
}

export type TransactionActionOutcome<TResult> =
  { skipped: true } | { skipped: false; result: TResult };

export interface TransactionTracker<TResult> {
  getState: (key: string) => TransactionState<TResult>;
  isPending: (key: string) => boolean;
  run: (
    key: string,
    steps: TransactionActionSteps<TResult>,
  ) => Promise<TransactionActionOutcome<TResult>>;
}

const IDLE = Object.freeze({ status: 'idle' as const });

export function createTransactionTracker<TResult>(
  onChange?: (key: string, state: TransactionState<TResult>) => void,
): TransactionTracker<TResult> {
  const states = new Map<string, TransactionState<TResult>>();

  function set(key: string, state: TransactionState<TResult>) {
    if (state.status === 'idle') {
      states.delete(key);
    } else {
      states.set(key, state);
    }
    onChange?.(key, state);
  }

  function getState(key: string): TransactionState<TResult> {
    return states.get(key) ?? IDLE;
  }

  function isPending(key: string): boolean {
    return getState(key).status === 'pending';
  }

  async function run(
    key: string,
    steps: TransactionActionSteps<TResult>,
  ): Promise<TransactionActionOutcome<TResult>> {
    const previous = getState(key);
    if (previous.status === 'pending') {
      return { skipped: true };
    }

    // Mark pending synchronously so a second trigger in the same tick is ignored.
    set(key, { status: 'pending' });

    let result: TResult | undefined = previous.status === 'confirmed' ? previous.result : undefined;

    try {
      if (result === undefined) {
        result =
          previous.status === 'retryable' && previous.submittedTransaction
            ? await steps.resume(previous.submittedTransaction)
            : await steps.submit();
      }

      if (steps.record) {
        await steps.record(result);
      }

      set(key, IDLE);
      return { skipped: false, result };
    } catch (error) {
      if (result !== undefined) {
        // The chain already confirmed; a retry must only re-record it.
        set(key, { status: 'confirmed', result, error });
      } else if (asCoded(error).code === 'USER_CANCELLED') {
        set(key, IDLE);
      } else {
        // Errors raised after the envelope reached the network carry it as
        // `submittedTransaction`; without it a retry safely builds a new one.
        const status = classifyTransactionError(error);
        set(key, {
          status,
          submittedTransaction:
            status === 'retryable' ? asCoded(error).submittedTransaction : undefined,
          error,
        });
      }
      throw error;
    }
  }

  return { getState, isPending, run };
}
