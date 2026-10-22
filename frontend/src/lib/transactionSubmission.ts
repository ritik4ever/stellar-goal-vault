import { classifySigningError } from './signingErrors';

export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'retryable';

export interface TransactionStatusUpdate {
  status: TransactionStatus;
  transactionHash?: string;
  errorCode?: string;
}

export type TransactionStatusListener = (update: TransactionStatusUpdate) => void;
export type TransactionStatusReporter = (update: TransactionStatusUpdate) => void;

interface InFlightSubmission {
  promise: Promise<unknown>;
  status: TransactionStatusUpdate;
  listeners: Set<TransactionStatusListener>;
}

const inFlightSubmissions = new Map<string, InFlightSubmission>();

function notify(entry: InFlightSubmission, update: TransactionStatusUpdate): void {
  entry.status = update;
  for (const listener of entry.listeners) {
    listener(update);
  }
}

function isRetryableFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === 'USER_CANCELLED' ||
    code === 'CONTRACT_CALL_FAILED' ||
    code === 'TRANSACTION_FAILED'
  ) {
    return false;
  }
  const signingErrorClass = classifySigningError(error);
  return (
    signingErrorClass === 'RPC_FAILURE' ||
    signingErrorClass === 'USER_REJECTED' ||
    signingErrorClass === 'WALLET_UNAVAILABLE'
  );
}

export function submitTransactionOnce<T>(
  key: string,
  submit: (reportStatus: TransactionStatusReporter) => Promise<T>,
  onStatusChange?: TransactionStatusListener,
): Promise<T> {
  const existing = inFlightSubmissions.get(key);
  if (existing) {
    if (onStatusChange) {
      existing.listeners.add(onStatusChange);
      onStatusChange(existing.status);
    }
    return existing.promise as Promise<T>;
  }

  const entry: InFlightSubmission = {
    promise: Promise.resolve(),
    status: { status: 'pending' },
    listeners: new Set(onStatusChange ? [onStatusChange] : []),
  };
  const promise = Promise.resolve()
    .then(() => submit((update) => notify(entry, update)))
    .then((result) => {
      const transactionHash =
        result && typeof result === 'object' && 'transactionHash' in result
          ? (result as { transactionHash?: unknown }).transactionHash
          : undefined;
      notify(entry, {
        status: 'confirmed',
        ...(typeof transactionHash === 'string' ? { transactionHash } : {}),
      });
      return result;
    })
    .catch((error: unknown) => {
      notify(entry, {
        status: isRetryableFailure(error) ? 'retryable' : 'failed',
        ...(entry.status.transactionHash ? { transactionHash: entry.status.transactionHash } : {}),
        ...(typeof (error as { code?: unknown } | null)?.code === 'string'
          ? { errorCode: (error as { code: string }).code }
          : {}),
      });
      throw error;
    })
    .finally(() => {
      if (inFlightSubmissions.get(key) === entry) {
        inFlightSubmissions.delete(key);
      }
    });

  entry.promise = promise;
  inFlightSubmissions.set(key, entry);
  for (const listener of entry.listeners) {
    listener(entry.status);
  }
  return promise;
}
