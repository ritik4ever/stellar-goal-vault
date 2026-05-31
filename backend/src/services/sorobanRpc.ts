import axios from "axios";
import { config } from "../config";
import { AppError } from "../types/errors";

export interface VerifiedSorobanTransaction {
  txHash: string;
  status: "SUCCESS";
  ledger?: number;
  createdAt?: number;
  latestLedger: number;
}

interface RpcTransactionResponse {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  txHash: string;
  latestLedger: number;
  ledger?: number;
  createdAt?: number;
}

/**
 * Guards that the Soroban refund configuration is present before making RPC calls.
 *
 * @throws {AppError} 503 `SOROBAN_REFUND_NOT_CONFIGURED` if `contractId` is missing from config.
 * @throws {AppError} 503 `SOROBAN_RPC_NOT_CONFIGURED` if `sorobanRpcUrl` is missing from config.
 */
export function ensureSorobanRefundConfig(): void {
  if (!config.contractId) {
    throw new AppError(
      "Refund contract is not configured on the backend.",
      503,
      "SOROBAN_REFUND_NOT_CONFIGURED",
    );
  }

  if (!config.sorobanRpcUrl) {
    throw new AppError(
      "Soroban RPC URL is not configured on the backend.",
      503,
      "SOROBAN_RPC_NOT_CONFIGURED",
    );
  }
}

/**
 * Queries the Soroban RPC node to confirm a refund transaction succeeded on-chain.
 *
 * @param txHash - The Soroban transaction hash to verify.
 * @returns A {@link VerifiedSorobanTransaction} object when the transaction is confirmed as `SUCCESS`.
 * @throws {AppError} 503 when Soroban config is missing (delegated to {@link ensureSorobanRefundConfig}).
 * @throws {AppError} 409 `SOROBAN_TX_PENDING` when the transaction is not yet confirmed (`NOT_FOUND`).
 * @throws {AppError} 400 `SOROBAN_TX_FAILED` when the transaction was rejected on-chain (`FAILED`).
 * @throws {AppError} 502 `SOROBAN_RPC_INVALID_RESPONSE` when the RPC returns an empty result body.
 * @throws {AppError} 502 `SOROBAN_RPC_UNAVAILABLE` when the RPC endpoint is unreachable.
 */
export async function verifyRefundTransaction(txHash: string): Promise<VerifiedSorobanTransaction> {
  ensureSorobanRefundConfig();

  try {
    const response = await axios.post(
      config.sorobanRpcUrl,
      {
        jsonrpc: "2.0",
        id: txHash,
        method: "getTransaction",
        params: {
          hash: txHash,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
      },
    );

    const result = response.data?.result as RpcTransactionResponse | undefined;
    if (!result) {
      throw new AppError(
        "Soroban RPC returned an empty transaction response.",
        502,
        "SOROBAN_RPC_INVALID_RESPONSE",
      );
    }

    if (result.status === "NOT_FOUND") {
      throw new AppError(
        "Refund transaction has not been confirmed on Soroban yet. Try again in a moment.",
        409,
        "SOROBAN_TX_PENDING",
      );
    }

    if (result.status === "FAILED") {
      throw new AppError(
        "Refund transaction failed on Soroban, so local state was not updated.",
        400,
        "SOROBAN_TX_FAILED",
      );
    }

    return {
      txHash: result.txHash,
      status: "SUCCESS",
      ledger: result.ledger,
      createdAt: result.createdAt,
      latestLedger: result.latestLedger,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "Unable to verify the Soroban refund transaction right now.",
      502,
      "SOROBAN_RPC_UNAVAILABLE",
    );
  }
}
