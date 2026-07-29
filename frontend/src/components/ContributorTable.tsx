import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, ChevronLeft, ChevronRight, ArrowUpDown, List } from 'lucide-react';
import { CopyButton } from './CopyButton';
import { AddressAvatar } from './AddressAvatar';
import { EmptyState } from './EmptyState';
import { getCampaignPledges, PledgeSortField, PledgeSortOrder } from '../services/api';
import { stellarExpertTxUrl } from '../utils/stellar';
import type { Pledge } from '../types/campaign';

const PLEDGES_PER_PAGE = 20;

interface ContributorTableProps {
  campaignId?: string;
  networkPassphrase?: string;
  isLoading?: boolean;
}

type SortConfig = {
  field: PledgeSortField;
  order: PledgeSortOrder;
};

function formatDate(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toLocaleString();
}

function isAnonymous(contributor: string): boolean {
  return (
    contributor === 'Anonymous' ||
    contributor === 'anonymous' ||
    contributor.trim() === ''
  );
}

export function ContributorTable({
  campaignId,
  networkPassphrase,
  isLoading: externalLoading,
}: ContributorTableProps) {
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [sort, setSort] = useState<SortConfig>({ field: 'createdAt', order: 'desc' });

  const fetchPledges = useCallback(async () => {
    if (!campaignId) return;

    setIsLoading(true);
    try {
      const response = await getCampaignPledges(campaignId, {
        page,
        limit: PLEDGES_PER_PAGE,
        sort: sort.field,
        order: sort.order,
      });

      setPledges(response.data);
      setTotalPages(response.pagination.totalPages);
      setTotalCount(response.pagination.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pledges');
    } finally {
      setIsLoading(false);
    }
  }, [campaignId, page, sort]);

  useEffect(() => {
    if (!campaignId) {
      setIsLoading(false);
      return;
    }

    void fetchPledges();
  }, [campaignId, fetchPledges]);

  function handleSort(field: PledgeSortField) {
    setSort((current) => ({
      field,
      order: current.field === field && current.order === 'desc' ? 'asc' : 'desc',
    }));
    setPage(1);
  }

  function handlePreviousPage() {
    setPage((current) => Math.max(1, current - 1));
  }

  function handleNextPage() {
    setPage((current) => Math.min(totalPages, current + 1));
  }

  const activeLoading = externalLoading || isLoading;

  // Loading state
  if (activeLoading && pledges.length === 0) {
    return (
      <section className="contributor-table-section" aria-label="Pledge list">
        <div className="contributor-table-header">
          <h3 className="contributor-table-title">Pledges</h3>
        </div>
        <div className="contributor-table-wrap">
          <div className="contributor-table" role="table" aria-label="Loading pledges">
            <div className="contributor-table-head" role="rowgroup">
              <div role="row" className="contributor-table-row pledges-header-row">
                <span role="columnheader">Contributor</span>
                <span role="columnheader">Amount</span>
                <span role="columnheader">Asset</span>
                <span role="columnheader">Date</span>
                <span role="columnheader">TX Hash</span>
              </div>
            </div>
            <div className="contributor-table-body" role="rowgroup">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} role="row" className="contributor-table-row">
                  <div role="cell">
                    <div className="skeleton skeleton-line" style={{ width: 120 }} />
                  </div>
                  <div role="cell">
                    <div className="skeleton skeleton-line" style={{ width: 60 }} />
                  </div>
                  <div role="cell">
                    <div className="skeleton skeleton-line" style={{ width: 50 }} />
                  </div>
                  <div role="cell">
                    <div className="skeleton skeleton-line" style={{ width: 100 }} />
                  </div>
                  <div role="cell">
                    <div className="skeleton skeleton-line" style={{ width: 80 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Error state
  if (error && pledges.length === 0) {
    return (
      <section className="contributor-table-section" aria-label="Pledge list">
        <div className="contributor-table-header">
          <h3 className="contributor-table-title">Pledges</h3>
        </div>
        <div className="form-error" role="alert">
          {error}
        </div>
      </section>
    );
  }

  // Empty state
  if (pledges.length === 0 && !activeLoading) {
    return (
      <section className="contributor-table-section" aria-label="Pledge list">
        <div className="contributor-table-header">
          <h3 className="contributor-table-title">Pledges</h3>
        </div>
        <EmptyState
          variant="inline"
          icon={List}
          title="No pledges yet"
          message="No pledges have been made to this campaign yet. Be the first to pledge!"
        />
      </section>
    );
  }

  return (
    <section className="contributor-table-section" aria-label="Pledge list">
      <div className="contributor-table-header">
        <h3 className="contributor-table-title">Pledges</h3>
        <span className="muted contributor-table-count">
          {totalCount} {totalCount === 1 ? 'pledge' : 'pledges'}
        </span>
      </div>

      <div className="contributor-table-wrap">
        <div className="contributor-table" role="table" aria-label="Pledge contributions">
          <div className="contributor-table-head" role="rowgroup">
            <div role="row" className="contributor-table-row pledges-header-row">
              <span role="columnheader">Contributor</span>
              <span
                role="columnheader"
                className="sortable-header"
                aria-sort={
                  sort.field === 'amount'
                    ? (sort.order === 'asc' ? 'ascending' : 'descending')
                    : 'none'
                }
              >
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => handleSort('amount')}
                  aria-label={`Sort by amount${sort.field === 'amount' ? ` (currently ${sort.order})` : ''}`}
                >
                  Amount
                  <ArrowUpDown
                    size={14}
                    className={`sort-icon ${sort.field === 'amount' ? 'sort-active' : ''}`}
                  />
                </button>
              </span>
              <span role="columnheader">Asset</span>
              <span
                role="columnheader"
                className="sortable-header"
                aria-sort={
                  sort.field === 'createdAt'
                    ? (sort.order === 'asc' ? 'ascending' : 'descending')
                    : 'none'
                }
              >
                <button
                  type="button"
                  className="sort-button"
                  onClick={() => handleSort('createdAt')}
                  aria-label={`Sort by date${sort.field === 'createdAt' ? ` (currently ${sort.order})` : ''}`}
                >
                  Date
                  <ArrowUpDown
                    size={14}
                    className={`sort-icon ${sort.field === 'createdAt' ? 'sort-active' : ''}`}
                  />
                </button>
              </span>
              <span role="columnheader">TX Hash</span>
            </div>
          </div>
          <div className="contributor-table-body" role="rowgroup">
            {pledges.map((pledge) => (
              <div key={pledge.id} role="row" className="contributor-table-row">
                <div
                  role="cell"
                  style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  {isAnonymous(pledge.contributor) ? (
                    <span className="mono anonymous-backer">Anonymous Backer</span>
                  ) : (
                    <>
                      <AddressAvatar address={pledge.contributor} size={24} />
                      <span className="mono">{pledge.contributor.slice(0, 12)}…</span>
                      <CopyButton
                        value={pledge.contributor}
                        ariaLabel={`Copy contributor ${pledge.contributor}`}
                        className="small"
                      />
                    </>
                  )}
                </div>
                <div role="cell">
                  <strong>{pledge.amount}</strong>
                </div>
                <div role="cell">
                  <span>{pledge.assetCode}</span>
                </div>
                <div role="cell">
                  <span className="muted">{formatDate(pledge.createdAt)}</span>
                </div>
                <div role="cell">
                  {pledge.transactionHash ? (
                    <a
                      href={stellarExpertTxUrl(pledge.transactionHash, networkPassphrase)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                      aria-label={`View transaction ${pledge.transactionHash.slice(0, 10)} on Stellar Explorer`}
                    >
                      <span className="mono">{pledge.transactionHash.slice(0, 10)}…</span>
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn-ghost pagination-btn"
            onClick={handlePreviousPage}
            disabled={page <= 1 || isLoading}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <span className="pagination-info muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost pagination-btn"
            onClick={handleNextPage}
            disabled={page >= totalPages || isLoading}
            aria-label="Next page"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}

export default ContributorTable;
