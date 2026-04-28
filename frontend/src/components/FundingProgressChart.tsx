import { TrendingUp } from "lucide-react";
import { CampaignEvent } from "../types/campaign";
import { EmptyState } from "./EmptyState";

interface FundingProgressChartProps {
  history: CampaignEvent[];
  targetAmount: number;
  currentAmount: number;
  assetCode: string;
}

interface ProgressPoint {
  id: string;
  label: string;
  timestamp: number;
  total: number;
  type: "created" | "pledged" | "refunded" | "claimed" | "current" | "start";
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function describeEvent(event: CampaignEvent): string {
  switch (event.eventType) {
    case "created":
      return "Campaign launched";
    case "pledged":
      return "Pledge received";
    case "refunded":
      return "Refund processed";
    case "claimed":
      return "Funds claimed";
    default:
      return event.eventType;
  }
}

function buildProgressPoints(
  history: CampaignEvent[],
  currentAmount: number,
): ProgressPoint[] {
  const sortedHistory = [...history].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.id - b.id;
  });

  let total = 0;
  const points: ProgressPoint[] = [
    {
      id: "start",
      label: "Start",
      timestamp: sortedHistory[0]?.timestamp ?? Math.floor(Date.now() / 1000),
      total: 0,
      type: "start",
    },
  ];

  for (const event of sortedHistory) {
    const amount = typeof event.amount === "number" ? event.amount : 0;

    if (event.eventType === "pledged") {
      total += amount;
    }

    if (event.eventType === "refunded") {
      total -= amount;
    }

    points.push({
      id: `event-${event.id}`,
      label: describeEvent(event),
      timestamp: event.timestamp,
      total: Math.max(0, total),
      type: event.eventType,
    });
  }

  const finalAmount = Math.max(0, currentAmount);
  if (points[points.length - 1]?.total !== finalAmount) {
    points.push({
      id: "current",
      label: "Current total",
      timestamp: sortedHistory[sortedHistory.length - 1]?.timestamp ?? Math.floor(Date.now() / 1000),
      total: finalAmount,
      type: "current",
    });
  }

  return points;
}

export function FundingProgressChart({
  history,
  targetAmount,
  currentAmount,
  assetCode,
}: FundingProgressChartProps) {
  if (!history.length) {
    return (
      <EmptyState
        variant="card"
        icon={TrendingUp}
        title="Funding progress"
        message="No pledge or refund history exists yet. New contributions will appear here when activity begins."
      />
    );
  }

  const points = buildProgressPoints(history, currentAmount);
  const maxAmount = Math.max(targetAmount, ...points.map((point) => point.total), 1);

  return (
    <section className="card funding-progress-card">
      <div className="section-heading">
        <h2>Funding progress</h2>
        <p className="muted">
          Visualized from the selected campaign's pledge and refund history.
        </p>
      </div>

      <div className="funding-summary">
        <article>
          <span>Target amount</span>
          <strong>
            {targetAmount} {assetCode}
          </strong>
        </article>
        <article>
          <span>Current amount</span>
          <strong>
            {currentAmount} {assetCode}
          </strong>
        </article>
        <article>
          <span>Progress</span>
          <strong>{Math.round((currentAmount / Math.max(targetAmount, 1)) * 100)}%</strong>
        </article>
      </div>

      <div className="funding-history-list">
        {points.map((point) => {
          const progress = Math.min(100, Math.max(0, (point.total / maxAmount) * 100));
          return (
            <div key={point.id} className="funding-history-step">
              <div className="funding-history-meta">
                <span>{point.label}</span>
                <span className="muted">{formatDate(point.timestamp)}</span>
              </div>
              <div className="funding-history-bar" aria-hidden>
                <div
                  className="funding-history-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="funding-history-values">
                <span className="muted">Total</span>
                <strong>
                  {point.total} {assetCode}
                </strong>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
