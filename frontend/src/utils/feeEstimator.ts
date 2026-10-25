export function estimateSorobanFee(instructionCount: number): number {
  const BASE_FEE = 100; // stroops
  const PER_INSTRUCTION = 1;
  const fee = BASE_FEE + instructionCount * PER_INSTRUCTION;
  const xlmFee = fee / 10_000_000; // Convert stroops to XLM
  return Math.max(xlmFee, 0.00001);
}
