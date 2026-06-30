import { useState, useEffect, useCallback, useRef } from 'react';
import { Users } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { AddressAvatar } from './AddressAvatar';
import { EmptyState } from './EmptyState';
import { ContributorSummary as ContributorSummaryData } from '../types/campaign';
import { apiRequest } from '../services/httpClient';
import { buildContributorCsv, downloadCsv } from '../utils/exportCsv';

const POLL_INTERVAL_MS = 30_000;

interface ContributorSummaryProps {
  campaignId?: string;
  assetCode: string;
  isLoading?: boolean;
}

interface ContributorsApiResponse {
  data: ContributorSummaryData[];
}

export function ContributorSummary({
  campaignId,
  assetCode,
  isLoading: externalLoading,
}: ContributorSummaryProps) {
  const [contributors, setContributors] = useState<ContributorSummaryData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchContributors = useCallback(async () => {
    if (!campaignId) return;

    try {
      const response = await apiRequest<ContributorsApiResponse>({
        method: 'GET',
        url: `/campaigns/${campaignId}/contributors`,
      });

      // Sort by totalPledged descending (primary), then by contributor address (stable tiebreak)
      const sorted = [...response.data].sort((a, b) => {
        if (b.totalPledged !== a.totalPledged) {
          return b.totalPledged - a.totalPledged;
        }
        return a.contributor.localeCompare(b.contributor);
      });

      setContributors(sorted);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contributors');
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void fetchContributors();

    // Poll every 30 seconds
    timerRef.current = setInterval(() => {
      void fetchContributors();
    }, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [campaignId, fetchContributors]);

  if (externalLoading || (isLoading && contributors.length === 0)) {
    return (
      <section
        className="contributor-summary contributor-summary-loading"
        aria-label="Contributor summary"
      >
        <h3 className="contributor-summary-title">Contributors</h3>
        <div className="contributor-summary-stats" style={{ marginTop: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <article key={i} className="contributor-stat">
              <div className="skeleton skeleton-line" style={{ width: 100 }} />
              <div
                className="skeleton skeleton-line"
                style={{ width: 60, height: 20, marginTop: 8 }}
              />
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="contributor-summary" aria-label="Contributor summary">
        <div className="contributor-summary-heading">
          <h3 className="contributor-summary-title">Contributor summary</h3>
        </div>
        <div className="form-error" role="alert">
          {error}
        </div>
      </section>
    );
  }

  if (contributors.length === 0) {
    return (
      <section className="contributor-summary" aria-label="Contributor summary">
        <div className="contributor-summary-heading">
          <h3 className="contributor-summary-title">Contributor summary</h3>
        </div>
        <EmptyState
          variant="inline"
          icon={Users}
          title="No contributors yet"
          message="No pledges have been made to this campaign yet. Be the first to pledge!"
        />
      </section>
    );
  }

  // Compute stats from the API data
  const uniqueAddresses = contributors.length;
  const activeAddresses = contributors.filter((c) => !c.isFullyRefunded).length;
  const activeGrandTotal = Number(
    contributors.reduce((sum, c) => sum + c.totalPledged, 0).toFixed(2),
  );
  const refundedGrandTotal = Number(
    contributors.reduce((sum, c) => sum + c.refundedAmount, 0).toFixed(2),
  );

  function handleExportCsv() {
    const filename = `contributors-${campaignId ?? 'export'}.csv`;
    downloadCsv(filename, buildContributorCsv(contributors));
  }

  return (
    <section className="contributor-summary" aria-label="Contributor summary">
      <div className="contributor-summary-heading">
        <h3 className="contributor-summary-title">Contributor summary</h3>
        <button
          type="button"
          className="btn-ghost small"
          onClick={handleExportCsv}
          aria-label="Export contributors as CSV"
        >
          Export CSV
        </button>
      </div>

      <div className="contributor-summary-stats">
        <article className="contributor-stat">
          <span className="contributor-stat-label">Ever pledged</span>
          <strong>{uniqueAddresses}</strong>
          <span className="contributor-stat-hint muted">
            Distinct addresses with any pledge on record (including refunded).
          </span>
        </article>
        <article className="contributor-stat">
          <span className="contributor-stat-label">Still active</span>
          <strong>{activeAddresses}</strong>
          <span className="contributor-stat-hint muted">
            Addresses that currently have at least one non-refunded pledge.
          </span>
        </article>
        <article className="contributor-stat">
          <span className="contributor-stat-label">Active total</span>
          <strong>
            {activeGrandTotal} {assetCode}
          </strong>
          <span className="contributor-stat-hint muted">Sum of all non-refunded pledges.</span>
        </article>
        <article className="contributor-stat">
          <span className="contributor-stat-label">Refunded total</span>
          <strong>
            {refundedGrandTotal} {assetCode}
          </strong>
          <span className="contributor-stat-hint muted">
            Historical refunds only; not counted in active.
          </span>
        </article>
      </div>

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
                <CopyButton
                  value={row.contributor}
                  ariaLabel={`Copy contributor ${row.contributor}`}
                  className="small"
                />
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
    </section>
  );
}
