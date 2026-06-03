export interface OpenIssue {
  id: string;
  title: string;
  labels: string[];
  summary: string;
  complexity: 'Trivial' | 'Medium' | 'High';
  points: 100 | 150 | 200;
}

const seededIssues: OpenIssue[] = [
  {
    id: 'SGV-1',
    title: 'Implement Freighter-signed pledge transactions',
    labels: ['enhancement', 'help wanted', 'soroban'],
    summary:
      'Replace mock API pledges with wallet-signed Soroban transactions, then surface transaction hashes and simulation errors in the UI timeline.',
    complexity: 'High',
    points: 200,
  },
  {
    id: 'SGV-2',
    title: 'Sync campaign status from Soroban events',
    labels: ['backend', 'indexer', 'good first issue'],
    summary:
      'Add an RPC event indexer that backfills pledge, claim, and refund events so local SQLite stays aligned with on-chain campaign activity.',
    complexity: 'Medium',
    points: 150,
  },
  {
    id: 'SGV-3',
    title: 'Add campaign filtering and sort presets',
    labels: ['frontend', 'ux', 'good first issue'],
    summary:
      'Support filtering by asset and status, plus quick sorts for nearing-deadline and most-funded campaigns to improve the contributor dashboard.',
    complexity: 'Trivial',
    points: 100,
  },
];

export async function fetchOpenIssues(): Promise<OpenIssue[]> {
  return seededIssues;
}
