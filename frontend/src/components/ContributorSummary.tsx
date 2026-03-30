import { useMemo } from "react";
import { CopyButton } from "./CopyButton";
import { Pledge } from "../types/campaign";

function round2(value: number): number {
  return Number(value.toFixed(2));
}

interface AggregatedContributor {
  contributor: string;
  activeTotal: number;
  activePledgeCount: number;
  refundedTotal: number;
  refundedPledgeCount: number;
  hasPending: boolean;
}

interface ContributorSummaryProps {
  pledges?: Pledge[];
  assetCode: string;
  isLoading?: boolean;
}
export function ContributorSummary({
  pledges,
  assetCode,
  isLoading,
}: ContributorSummaryProps) {
  if (isLoading || pledges === undefined) {
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

  const {
    rows,
    uniqueAddresses,
    activeAddresses,
    activeGrandTotal,
    refundedGrandTotal,
  } = useMemo(() => {
    const list = pledges ?? [];
    const byContributor = new Map<
      string,
      {
        activeTotal: number;
        activePledgeCount: number;
        refundedTotal: number;
        refundedPledgeCount: number;
        hasPending: boolean;
      }
    >();

    for (const pledge of list) {
      let bucket = byContributor.get(pledge.contributor);
      if (!bucket) {
        bucket = {
          activeTotal: 0,
          activePledgeCount: 0,
          refundedTotal: 0,
          refundedPledgeCount: 0,
          hasPending: false,
        };
        byContributor.set(pledge.contributor, bucket);
      }

      if (pledge.refundedAt !== undefined) {
        bucket.refundedTotal += pledge.amount;
        bucket.refundedPledgeCount += 1;
      } else {
        bucket.activeTotal += pledge.amount;
        bucket.activePledgeCount += 1;
      }

      if (pledge.id < 0) {
        bucket.hasPending = true;
      }
    }

    const aggregated: AggregatedContributor[] = [
      ...byContributor.entries(),
    ].map(([contributor, bucket]) => ({
      contributor,
      activeTotal: round2(bucket.activeTotal),
      activePledgeCount: bucket.activePledgeCount,
      refundedTotal: round2(bucket.refundedTotal),
      refundedPledgeCount: bucket.refundedPledgeCount,
      hasPending: bucket.hasPending,
    }));

    aggregated.sort((a, b) => {
      if (b.activeTotal !== a.activeTotal) {
        return b.activeTotal - a.activeTotal;
      }
      if (b.refundedTotal !== a.refundedTotal) {
        return b.refundedTotal - a.refundedTotal;
      }
      return a.contributor.localeCompare(b.contributor);
    });

    const activeAddresses = aggregated.filter(
      (row) => row.activePledgeCount > 0,
    ).length;
    const activeGrandTotal = round2(
      aggregated.reduce((sum, row) => sum + row.activeTotal, 0),
    );
    const refundedGrandTotal = round2(
      aggregated.reduce((sum, row) => sum + row.refundedTotal, 0),
    );

    return {
      rows: aggregated,
      uniqueAddresses: byContributor.size,
      activeAddresses,
      activeGrandTotal,
      refundedGrandTotal,
    };
  }, [pledges]);

  if (!pledges?.length) {
    return (
      <section className="contributor-summary" aria-label="Contributor summary">
        <h3 className="contributor-summary-title">Contributors</h3>
        <p className="muted">No pledges yet for this campaign.</p>
      </section>
    );
  }

  return (
    <section className="contributor-summary" aria-label="Contributor summary">
      <div className="contributor-summary-heading">
        <h3 className="contributor-summary-title">Contributor summary</h3>
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
          <span className="contributor-stat-hint muted">
            Sum of all non-refunded pledges.
          </span>
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

      <div
        className="contributor-table-wrap"
        role="table"
        aria-label="Contributors by address"
      >
        <div
          className="contributor-table contributor-table-head"
          role="rowgroup"
        >
          <div role="row" className="contributor-table-row">
            <span role="columnheader">Contributor</span>
            <span role="columnheader">Active</span>
            <span role="columnheader">Refunded</span>
          </div>
        </div>
        <div
          className="contributor-table contributor-table-body"
          role="rowgroup"
        >
          {rows.map((row) => (
            <div
              key={row.contributor}
              role="row"
              className="contributor-table-row"
            >
              <div
                role="cell"
                className="contributor-address"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span className="mono">{row.contributor.slice(0, 12)}…</span>
                <CopyButton
                  value={row.contributor}
                  ariaLabel={`Copy contributor ${row.contributor}`}
                  className="small"
                />
                {row.hasPending ? (
                  <span className="badge badge-neutral contributor-pending-badge">
                    Pending
                  </span>
                ) : null}
              </div>
              <div role="cell" className="contributor-amounts">
                {row.activePledgeCount > 0 ? (
                  <span>
                    <strong>
                      {row.activeTotal} {assetCode}
                    </strong>
                    <span className="muted">
                      {" "}
                      ({row.activePledgeCount} pledge
                      {row.activePledgeCount === 1 ? "" : "s"})
                    </span>
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
              <div role="cell" className="contributor-amounts">
                {row.refundedPledgeCount > 0 ? (
                  <span className="contributor-refunded">
                    <strong>
                      {row.refundedTotal} {assetCode}
                    </strong>
                    <span className="muted">
                      {" "}
                      ({row.refundedPledgeCount} refunded)
                    </span>
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
