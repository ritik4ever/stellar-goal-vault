/**
 * Format a numeric amount for display with optional asset code suffix.
 *
 * Magnitude rules:
 *  - Zero: "0"
 *  - Sub-cent amounts (0 < |amount| < 0.01): up to 7 decimal places for XLM-like tokens
 *  - Medium amounts (0.01 ≤ |amount| < 1_000): locale-formatted with 2 decimal places
 *  - Thousands+ (|amount| ≥ 1_000): compact notation (e.g., "1.2K", "3.4M")
 *
 * @param amount   The numeric amount to format.
 * @param assetCode Optional asset code to append (e.g., "USDC", "XLM").
 * @returns The formatted string, e.g. "1,234.56 USDC", "1.2K USDC", "0.0000001 XLM".
 */

// Cached Intl.NumberFormat instances – re-created on each call would be wasteful
// in render-hot paths.
const smallFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 7,
});

const mediumFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFmt = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  compactDisplay: 'short',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatAmount(amount: number, assetCode?: string): string {
  const absAmount = Math.abs(amount);

  let formatted: string;

  if (amount === 0) {
    formatted = '0';
  } else if (absAmount < 0.01 && absAmount > 0) {
    // Very small amounts (e.g. XLM fractional units): up to 7 decimal places
    formatted = smallFmt.format(amount);
  } else if (absAmount < 1_000) {
    // Normal everyday amounts: 2 decimal places
    formatted = mediumFmt.format(amount);
  } else {
    // Thousands and above: compact notation (1.2K, 3.4M, etc.)
    formatted = compactFmt.format(amount);
  }

  return assetCode ? `${formatted} ${assetCode}` : formatted;
}
