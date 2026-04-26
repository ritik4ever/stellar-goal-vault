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
