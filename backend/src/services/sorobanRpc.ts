import axios from 'axios';
import { config } from '../config';
import { AppError } from '../types/errors';
import dotenv from 'dotenv';
import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';

dotenv.config();

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

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org:443';
const CONTRACT_ID = process.env.CONTRACT_ID || '';

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

/**
 * Fetch the campaign count from the Soroban contract.
 *
 * Calls the `get_campaign_count` read-only function on the deployed contract.
 * This represents the total number of campaigns created on-chain.
 *
 * @returns The campaign count as a number, or 0 if the contract is not configured
 *          or if the call fails.
 */
export async function getCampaignCountFromContract(): Promise<number> {
  // If contract is not configured, return 0 gracefully (stats endpoint remains functional)
  if (!CONTRACT_ID || !SOROBAN_RPC_URL) {
    return 0;
  }

  try {
    // Create an RPC server instance
    const server = new rpc.Server(SOROBAN_RPC_URL, {
      allowHttp: SOROBAN_RPC_URL.startsWith('http://'),
    });

    // Create a contract client wrapper
    const contract = new Contract(CONTRACT_ID);

    // Build a read-only invocation to get_campaign_count
    // Note: This creates a simulated transaction; no account needed for read-only calls
    const operation = contract.call('get_campaign_count');

    // Create a minimal transaction for simulation (using a placeholder account)
    // Read-only operations don't require a real account, so we use a dummy address
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0',
    );

    const transaction = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(operation)
      .setTimeout(60)
      .build();

    // Simulate the transaction to get the result
    const simulated = await server.simulateTransaction(transaction);

    // Check if simulation was successful
    if (rpc.Api.isSimulationError(simulated)) {
      return 0;
    }

    // Extract the result from the simulation
    // The result contains XDR-encoded return values
    if (!rpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
      return 0;
    }

    // Parse the u64 value from the XDR result
    // Using scValToNative to decode Soroban's ScVal format
    const { scValToNative } = await import('@stellar/stellar-sdk');
    const decoded = scValToNative(simulated.result.retval);

    // The result should be a number (u64)
    if (typeof decoded === 'number' || typeof decoded === 'bigint') {
      return Number(decoded);
    }

    return 0;
  } catch (error) {
    // Log and gracefully return 0 so stats endpoint remains functional
    // even if contract call fails
    return 0;
  }
}
