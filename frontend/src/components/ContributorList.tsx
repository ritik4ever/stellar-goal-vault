import type { ContributorSummary } from '../types/campaign';
import { CopyButton } from './CopyButton';
import { AddressAvatar } from './AddressAvatar';

interface ContributorListProps {
  contributors: ContributorSummary[];
  assetCode: string;
}

export function ContributorList({ contributors, assetCode }: ContributorListProps) {
  return (
    <div className="contributor-table-wrap" role="table" aria-label="Contributors by address">
      <div className="contributor-table contributor-table-head" role="rowgroup">
        <div role="row" className="contributor-table-row">
          <span role="columnheader">Contributor</span>
          <span role="columnheader">Active pledge</span>
          <span role="columnheader">Refund status</span>
        </div>
      </div>
      <div className="contributor-table contributor-table-body" role="rowgroup">
        {contributors.map((row) => (
          <div key={row.contributor} role="row" className="contributor-table-row">
            <div
              role="cell"
              className="contributor-address"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <AddressAvatar address={row.contributor} size={24} />
              <span className="mono">{row.contributor.slice(0, 12)}…</span>
              <CopyButton value={row.contributor} ariaLabel={`Copy contributor ${row.contributor}`} className="small" />
            </div>
            <div role="cell" className="contributor-amounts">
              {row.totalPledged > 0 ? (
                <strong>
                  {row.totalPledged} {assetCode}
                </strong>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
            <div role="cell" className="contributor-amounts">
              {row.isFullyRefunded ? (
                <span className="contributor-refunded">
                  <strong>
                    {row.refundedAmount} {assetCode}
                  </strong>
                  <span className="muted"> (fully refunded)</span>
                </span>
              ) : row.refundedAmount > 0 ? (
                <span className="contributor-refunded">
                  <strong>
                    {row.refundedAmount} {assetCode}
                  </strong>
                  <span className="muted"> (partial refund)</span>
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
