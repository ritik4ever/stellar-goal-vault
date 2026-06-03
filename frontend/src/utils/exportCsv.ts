import { ContributorSummary } from '../types/campaign';

export function buildContributorCsv(contributors: ContributorSummary[]): string {
  const header = 'address,totalPledged,refundedAmount,isFullyRefunded';
  const rows = contributors.map(
    (c) => `${c.contributor},${c.totalPledged},${c.refundedAmount},${c.isFullyRefunded}`,
  );
  return [header, ...rows].join('\n');
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
