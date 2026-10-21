/**
 * Transaction status utilities for deterministic transaction submission handling.
 * Represents the lifecycle of a transaction submission to prevent duplicate submissions
 * and provide clear status feedback.
 */

export type TransactionStatus = 'idle' | 'pending' | 'confirmed' | 'failed' | 'retryable';

/**
 * Represents the state of a transaction submission for a specific campaign/action.
 */
export interface TransactionState {
  status: TransactionStatus;
  campaignId: string;
  actionType: 'pledge' | 'claim' | 'refund';
  transactionHash?: string;
  confirmedAt?: number;
  error?: string;
  retryCount: number;
  startedAt: number;
  updatedAt: number;
}

/**
 * Creates an initial transaction state for a new submission.
 */
export function createTransactionState(
  campaignId: string,
  actionType: 'pledge' | 'claim' | 'refund',
): TransactionState {
  const now = Date.now();
  return {
    status: 'pending',
    campaignId,
    actionType,
    retryCount: 0,
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Updates a transaction state to confirmed.
 */
export function confirmTransaction(
  state: TransactionState,
  transactionHash: string,
  confirmedAt: number,
): TransactionState {
  return {
    ...state,
    status: 'confirmed',
    transactionHash,
    confirmedAt,
    updatedAt: Date.now(),
  };
}

/**
 * Updates a transaction state to failed.
 */
export function failTransaction(state: TransactionState, error: string): TransactionState {
  return {
    ...state,
    status: 'failed',
    error,
    updatedAt: Date.now(),
  };
}

/**
 * Updates a transaction state to retryable (for transient errors).
 */
export function retryTransaction(state: TransactionState, error: string): TransactionState {
  return {
    ...state,
    status: 'retryable',
    error,
    retryCount: state.retryCount + 1,
    updatedAt: Date.now(),
  };
}

/**
 * Checks if a transaction is in a terminal state (confirmed or failed).
 */
export function isTerminalStatus(status: TransactionStatus): boolean {
  return status === 'confirmed' || status === 'failed';
}

/**
 * Checks if a transaction can be retried.
 */
export function canRetry(status: TransactionStatus): boolean {
  return status === 'retryable' || status === 'failed';
}

/**
 * Checks if a transaction is currently in progress (pending or retryable).
 */
export function isInProgress(status: TransactionStatus): boolean {
  return status === 'pending' || status === 'retryable';
}

/**
 * Gets a human-readable label for a transaction status.
 */
export function getStatusLabel(status: TransactionStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'pending':
      return 'Submitting...';
    case 'confirmed':
      return 'Confirmed';
    case 'failed':
      return 'Failed';
    case 'retryable':
      return 'Retry available';
    default:
      return 'Unknown';
  }
}

/**
 * Gets a user-friendly message for a transaction status.
 */
export function getStatusMessage(state: TransactionState): string {
  switch (state.status) {
    case 'pending':
      return 'Submitting transaction...';
    case 'confirmed':
      return `Transaction confirmed${state.transactionHash ? ` (${state.transactionHash.slice(0, 12)}...)` : ''}`;
    case 'failed':
      return `Transaction failed: ${state.error || 'Unknown error'}`;
    case 'retryable':
      return `Transaction failed: ${state.error || 'Unknown error'}. You can retry.`;
    default:
      return 'Ready to submit';
  }
}

/**
 * Error codes that should be treated as retryable.
 */
export const RETRYABLE_ERROR_CODES = new Set([
  'SUBMISSION_RETRY',
  'TRANSACTION_TIMEOUT',
  'SIMULATION_PREPARE_FAILED',
]);

/**
 * Determines if an error is retryable based on its code.
 */
export function isRetryableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code !== undefined && RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Creates a new transaction state from an error, determining if it's retryable.
 */
export function createErrorState(
  campaignId: string,
  actionType: 'pledge' | 'claim' | 'refund',
  error: unknown,
): TransactionState {
  const baseState = createTransactionState(campaignId, actionType);
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  if (isRetryableError(error)) {
    return retryTransaction(baseState, errorMessage);
  }

  return failTransaction(baseState, errorMessage);
}
