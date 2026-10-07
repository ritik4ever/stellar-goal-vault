/**
 * Recoverable error handling for the Pledge flow (#836).
 *
 * Every failure is classified into a user-facing message plus exactly one
 * recovery action, so the pledge form can keep the user's input and offer the
 * right next step instead of a dead-end toast.
 *
 * The most important distinction is between a pledge that never reached the
 * chain (safe to retry the pledge) and one that was confirmed on-chain but
 * could not be synced to the backend (`PLEDGE_SYNC_FAILED`): retrying the
 * pledge there would charge the contributor twice, so the only offered action
 * is to retry the sync with the same transaction hash (the backend
 * deduplicates reconciliation by transaction hash).
 */

export type PledgeRecovery =
  /** Submit the same pledge again. */
  | 'retry'
  /** The pledge is on-chain; only re-sync it with the backend. */
  | 'retry-sync'
  /** Connect (or unlock) the wallet, then pledge again. */
  | 'connect-wallet'
  /** The entered amount must be corrected before pledging again. */
  | 'fix-input'
  /** Nothing the user can do from the form (e.g. misconfiguration). */
  | 'none';

export interface PledgeFailure {
  readonly code: string;
  readonly message: string;
  readonly recovery: PledgeRecovery;
  /** Set when the transaction was submitted, e.g. for PLEDGE_SYNC_FAILED. */
  readonly transactionHash?: string;
}

/** Error thrown by the app-level pledge handler for flow-level failures. */
export class PledgeFlowError extends Error {
  readonly code: string;
  readonly transactionHash?: string;

  constructor(code: string, message: string, options?: { transactionHash?: string; cause?: unknown }) {
    super(message);
    this.name = 'PledgeFlowError';
    this.code = code;
    this.transactionHash = options?.transactionHash;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export const PLEDGE_FALLBACK_MESSAGE = 'The pledge could not be completed. Please try again.';

const FEE_ESTIMATION_CODES = new Set([
  'SIMULATION_FAILED',
  'SIMULATION_PREPARE_FAILED',
  'SOURCE_ACCOUNT_LOAD_FAILED',
  'STATE_RESTORE_REQUIRED',
]);

const INPUT_CODES = new Set(['INVALID_AMOUNT', 'INVALID_AMOUNT_PRECISION']);

const MISCONFIGURATION_CODES = new Set(['CONFIG_MISSING', 'INVALID_DECIMALS']);

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

function readMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === 'string' && error.trim().length > 0) return error;
  return null;
}

/**
 * Map any pledge failure to a message and a single recovery action.
 * Unknown errors keep their message and remain retryable.
 */
export function classifyPledgeError(error: unknown): PledgeFailure {
  const code = (error as { code?: unknown } | null)?.code;
  const transactionHash = (error as { transactionHash?: unknown } | null)?.transactionHash;
  const message = readMessage(error);

  if (typeof code === 'string') {
    if (FEE_ESTIMATION_CODES.has(code)) {
      return { code, recovery: 'retry', message: 'Could not estimate fee. Check your connection and retry.' };
    }
    if (INPUT_CODES.has(code)) {
      return { code, recovery: 'fix-input', message: message ?? 'Check the pledge amount and try again.' };
    }
    if (MISCONFIGURATION_CODES.has(code)) {
      return {
        code,
        recovery: 'none',
        message: 'Pledging is not configured correctly right now. Please try again later.',
      };
    }

    switch (code) {
      case 'PLEDGE_SYNC_FAILED':
        return {
          code,
          recovery: 'retry-sync',
          transactionHash: typeof transactionHash === 'string' ? transactionHash : undefined,
          message:
            typeof transactionHash === 'string'
              ? `Your pledge was confirmed on-chain (tx ${shortHash(transactionHash)}) but the campaign could not be updated. Retry sync — you will not be charged again.`
              : 'Your pledge was confirmed on-chain but the campaign could not be updated. Retry sync — you will not be charged again.',
        };
      case 'USER_CANCELLED':
        return {
          code,
          recovery: 'retry',
          message: 'Pledge cancelled. Your amount and token are kept — retry when you are ready.',
        };
      case 'WALLET_NOT_CONNECTED':
      case 'FREIGHTER_UNAVAILABLE':
      case 'FREIGHTER_ACCESS_DENIED':
        return {
          code,
          recovery: 'connect-wallet',
          message:
            code === 'WALLET_NOT_CONNECTED'
              ? 'Connect your wallet to pledge. Your amount and token are kept.'
              : (message ?? 'Freighter is not available. Unlock or connect it, then pledge again.'),
        };
      case 'TRANSACTION_TIMEOUT':
        return {
          code,
          recovery: 'retry',
          message:
            'The network did not confirm the pledge in time. It may still complete — check your wallet activity before retrying so you do not pledge twice.',
        };
      default:
        break;
    }
  }

  return {
    code: typeof code === 'string' ? code : 'UNKNOWN',
    recovery: 'retry',
    message: message ?? PLEDGE_FALLBACK_MESSAGE,
  };
}
