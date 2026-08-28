/**
 * Fee estimation utility for Stellar Soroban transactions.
 * Returns estimated fee in XLM for common operations.
 */

import { BASE_FEE } from "@stellar/stellar-sdk";

/**
 * Human-readable fee estimate for a Soroban transaction.
 * 
 * BASE_FEE on Stellar is typically 100 stroops (0.00001 XLM) per operation.
 * Soroban transactions are more expensive due to resource fees.
 * This provides a realistic overestimate for display purposes.
 */
export function estimateSorobanFee(opCount: number = 1): {
  baseFee: string;
  resourceFee: string;
  totalFee: string;
} {
  // Stellar base fee per operation
  const baseFeeStroops = Number(BASE_FEE); // typically 100
  const baseFeeTotalStroops = baseFeeStroops * opCount;
  const baseFeeXlm = baseFeeTotalStroops / 10_000_000;

  // Estimated resource fee for Soroban (class A contract call)
  // Real fee varies; this is a conservative overestimate
  const resourceFeeStroops = 50_000; // ~0.005 XLM per contract invocation
  const resourceFeeXlm = resourceFeeStroops / 10_000_000;

  return {
    baseFee: `${baseFeeXlm.toFixed(6)} XLM`,
    resourceFee: `${resourceFeeXlm.toFixed(6)} XLM`,
    totalFee: `${(baseFeeXlm + resourceFeeXlm).toFixed(6)} XLM`,
  };
}

/**
 * Get a user-friendly fee warning when balance may be insufficient.
 */
export function getFeeWarning(balanceXlm: number, opCount: number = 1): string | null {
  const { totalFee } = estimateSorobanFee(opCount);
  const totalFeeNum = parseFloat(totalFee.replace(" XLM", ""));

  if (balanceXlm <= 0) {
    return "Your wallet needs XLM to cover transaction fees.";
  }
  if (balanceXlm < totalFeeNum * 2) {
    return `Low XLM balance (${balanceXlm.toFixed(4)} XLM). You need at least ~${totalFee} for transaction fees.`;
  }
  return null;
}
