import { History } from 'lucide-react';
import { CampaignEvent } from '../types/campaign';
import { EmptyState } from './EmptyState';

const MILESTONES = [25, 50, 75] as const;

interface CampaignTimelineProps {
  history: CampaignEvent[];
  isLoading?: boolean;
  targetAmount?: number;
  pledgedAmount?: number;
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function truncate(value: string, start = 10, end = 8): string {
  if (value.length <= start + end + 1) {
    return value;
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function describeEvent(event: CampaignEvent): string {
  switch (event.eventType) {
    case 'created':
      return 'Campaign created';
    case 'pledged':
      return 'New pledge received';
    case 'claimed':
      return 'Creator claimed vault';
    case 'refunded':
      return 'Contributor refunded';
    default:
      return event.eventType;
  }
}

function getMetadataLines(event: CampaignEvent): string[] {
  const metadata = event.metadata ?? {};
  const lines: string[] = [];

  if (event.actor) {
    lines.push(`Actor: ${truncate(event.actor)}`);
  }

  if (typeof event.amount === 'number') {
    lines.push(`Amount: ${event.amount}`);
  }

  if (typeof metadata.refundedPledgeCount === 'number') {
    lines.push(`Refunded pledges: ${metadata.refundedPledgeCount}`);
  }

  if (typeof metadata.txHash === 'string') {
    lines.push(`Tx: ${truncate(metadata.txHash, 12, 10)}`);
  }

  if (typeof metadata.walletAddress === 'string') {
    lines.push(`Wallet: ${truncate(metadata.walletAddress)}`);
  }

  if (typeof metadata.refundSource === 'string') {
    lines.push(`Source: ${String(metadata.refundSource)}`);
  }

  if (typeof metadata.contractId === 'string') {
    lines.push(`Contract: ${truncate(metadata.contractId, 12, 10)}`);
  }

  if (typeof metadata.rpcUrl === 'string') {
    lines.push(`RPC: ${String(metadata.rpcUrl)}`);
  }

  if (typeof metadata.ledger === 'number') {
    lines.push(`Ledger: ${metadata.ledger}`);
  }

  if (typeof metadata.latestLedger === 'number') {
    lines.push(`Latest ledger seen: ${metadata.latestLedger}`);
  }

  return lines;
}

export function CampaignTimeline({
  history,
  isLoading = false,
  targetAmount,
  pledgedAmount,
}: CampaignTimelineProps) {
  const percentFunded =
    targetAmount && targetAmount > 0
      ? Math.min((pledgedAmount ?? 0) / targetAmount, 1) * 100
      : 0;

  const showProgress = typeof targetAmount === 'number' && targetAmount > 0;
  if (isLoading) {
    return (
      <section className="card">
        <div className="section-heading">
          <h2>Timeline</h2>
          <p className="muted">Loading campaign activity...</p>
        </div>
      </section>
    );
  }

  if (history.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={History}
        title="Timeline"
        message="No campaign activity yet. New Soroban and local events will appear here."
      />
    );
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Timeline</h2>
        <p className="muted">
          Local history is reconciled after successful contract actions so contributors can inspect
          refund metadata.
        </p>
      </div>

      {showProgress && (
        <div className="timeline-progress-wrap">
          <div
            className="timeline-progress-bar"
            role="progressbar"
            aria-valuenow={Math.round(percentFunded)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Campaign funded ${Math.round(percentFunded)}%`}
          >
            <div
              className="timeline-progress-fill"
              style={{ width: `${percentFunded}%` }}
            />
            {MILESTONES.map((pct) => {
              const milestoneAmount = (targetAmount! * pct) / 100;
              const isExceeded = (pledgedAmount ?? 0) >= milestoneAmount;
              if (isExceeded) return null;
              return (
                <div
                  key={pct}
                  className="timeline-milestone-tick"
                  style={{ left: `${pct}%` }}
                  aria-label={`${pct}% milestone: ${milestoneAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} target`}
                  role="img"
                >
                  <span className="timeline-milestone-tooltip">
                    {pct}%&nbsp;&mdash;&nbsp;
                    {milestoneAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })}
          </div>
          <span className="timeline-progress-label muted">
            {Math.round(percentFunded)}% funded
          </span>
        </div>
      )}


      <div className="timeline">
        {history.map((event) => {
          const isPending = event.metadata?.pending === true;
          const metadataLines = getMetadataLines(event);

          return (
            <article key={event.id} className={`timeline-item ${isPending ? 'pending' : ''}`}>
              <div className="timeline-dot" aria-hidden />
              <div className="timeline-copy">
                <strong>
                  {describeEvent(event)}
                  {isPending ? ' (pending...)' : ''}
                </strong>
                <span className="muted">{formatTimestamp(event.timestamp)}</span>
                {metadataLines.length > 0 ? (
                  metadataLines.map((line) => (
                    <span key={`${event.id}-${line}`} className="muted">
                      {line}
                    </span>
                  ))
                ) : (
                  <span className="muted">System event</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
