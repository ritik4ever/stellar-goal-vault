import axios from 'axios';
import { config } from '../config';
import { AppError } from '../types/errors';

export interface VerifiedSorobanTransaction {
  txHash: string;
  status: 'SUCCESS';
  ledger?: number;
  createdAt?: number;
  latestLedger: number;
}

interface RpcTransactionResponse {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
  txHash: string;
  latestLedger: number;
  ledger?: number;
  createdAt?: number;
}

/**
 * Ensure the backend has the minimal Soroban configuration required to perform refund
 * verification or any other RPC interaction used by refund-related flows.
 *
 * This helper centralises configuration checks so calling code can assume the
 * presence of `config.contractId` and `config.sorobanRpcUrl` after this returns.
 *
 * @throws {AppError} 503 `SOROBAN_REFUND_NOT_CONFIGURED` - thrown when `CONTRACT_ID`/`config.contractId` is
 *   missing. Refunds and pledge reconciliation require a deployed contract identifier.
 * @throws {AppError} 503 `SOROBAN_RPC_NOT_CONFIGURED` - thrown when `SOROBAN_RPC_URL`/`config.sorobanRpcUrl`
 *   is missing. All RPC calls require a reachable Soroban RPC endpoint.
 */
export function ensureSorobanRefundConfig(): void {
  if (!config.contractId) {
    throw new AppError(
      'Refund contract is not configured on the backend.',
      503,
      'SOROBAN_REFUND_NOT_CONFIGURED',
    );
  }

  if (!config.sorobanRpcUrl) {
    throw new AppError(
      'Soroban RPC URL is not configured on the backend.',
      503,
      'SOROBAN_RPC_NOT_CONFIGURED',
    );
  }
}

/**
 * Verify a Soroban transaction (used for refund reconciliation).
 *
 * This function performs a JSON-RPC `getTransaction` call to the configured Soroban
 * RPC node and translates common RPC responses into the application's `AppError`
 * types. The calling flow expects to mark local pledges as refunded only after the
 * RPC confirms the transaction `status: SUCCESS` so this function only returns a
 * `VerifiedSorobanTransaction` for confirmed successes.
 *
 * Typical flow in the application:
 * 1. The frontend simulates a pledge/refund transaction, then signs it in the wallet.
 * 2. The signed transaction is submitted to the network.
 * 3. The backend receives the transaction hash and calls this function to confirm
 *    the on-chain result before updating local state (reconcile).
 *
 * @param txHash - The Soroban transaction hash to verify (hex string or encoded hash).
 * @returns A {@link VerifiedSorobanTransaction} when the RPC reports the tx as `SUCCESS`.
 *
 * @throws {AppError} 503 when Soroban config is missing (delegated to {@link ensureSorobanRefundConfig}).
 * @throws {AppError} 409 `SOROBAN_TX_PENDING` when the RPC returns `NOT_FOUND` meaning the
 *   transaction has not yet been included in a ledger. Callers should retry after a delay.
 * @throws {AppError} 400 `SOROBAN_TX_FAILED` when the RPC reports the transaction executed but
 *   the status is `FAILED` — local state must not be updated and the cause should be surfaced.
 * @throws {AppError} 502 `SOROBAN_RPC_INVALID_RESPONSE` when the RPC returns an unexpected
 *   shape (empty/malformed body). This usually indicates a server-side issue with the RPC node.
 * @throws {AppError} 502 `SOROBAN_RPC_UNAVAILABLE` when the RPC endpoint is unreachable or
 *   when a network/axios error occurs while attempting the call.
 */
export async function verifyRefundTransaction(txHash: string): Promise<VerifiedSorobanTransaction> {
  // Ensure required config is present before making network calls. This fails-fast
  // with explicit AppErrors that are easier for higher layers to map to HTTP responses.
  ensureSorobanRefundConfig();

  try {
    // Build a standard JSON-RPC `getTransaction` body. The Soroban RPC follows
    // the JSON-RPC 2.0 spec; `id` is included for traceability and can be the
    // transaction hash so logs correlate easily.
    const response = await axios.post(
      config.sorobanRpcUrl,
      {
        jsonrpc: '2.0',
        id: txHash,
        method: 'getTransaction',
        params: {
          hash: txHash,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    // The RPC `result` contains transaction metadata. Defensive cast to our
    // internal `RpcTransactionResponse` interface helps reasoning about later
    // fields like `status` and `latestLedger`.
    const result = response.data?.result as RpcTransactionResponse | undefined;

    // If the RPC returns no `result` the node may be misbehaving or the body
    // shape changed; surface an AppError so the caller can treat it as a 502.
    if (!result) {
      throw new AppError(
        'Soroban RPC returned an empty transaction response.',
        502,
        'SOROBAN_RPC_INVALID_RESPONSE',
      );
    }

    if (result.status === 'NOT_FOUND') {
      throw new AppError(
        'Refund transaction has not been confirmed on Soroban yet. Try again in a moment.',
        409,
        'SOROBAN_TX_PENDING',
      );
    }

    if (result.status === 'FAILED') {
      throw new AppError(
        'Refund transaction failed on Soroban, so local state was not updated.',
        400,
        'SOROBAN_TX_FAILED',
      );
    }

    // At this point the RPC reported SUCCESS — return a shaped object containing
    // the transaction hash and ledger metadata that callers can use to reconcile
    // local DB state (mark pledges refunded, add event history, etc.).
    return {
      txHash: result.txHash,
      status: 'SUCCESS',
      ledger: result.ledger,
      createdAt: result.createdAt,
      latestLedger: result.latestLedger,
    };
  } catch (error) {
    // If we threw an AppError above, rethrow it unchanged so error handlers
    // can map it to specific HTTP responses.
    if (error instanceof AppError) {
      throw error;
    }

    // For any other network/library error, surface a generic RPC-unavailable
    // AppError so the caller can treat this as a temporary failure to retry.
    throw new AppError(
      'Unable to verify the Soroban refund transaction right now.',
      502,
      'SOROBAN_RPC_UNAVAILABLE',
    );
  }
}
