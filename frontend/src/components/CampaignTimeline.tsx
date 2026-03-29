import { History } from "lucide-react";
import { CampaignEvent } from "../types/campaign";
import { EmptyState } from "./EmptyState";

interface CampaignTimelineProps {
  history: CampaignEvent[];
}

function formatTimestamp(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function describeEvent(event: CampaignEvent): string {
  switch (event.eventType) {
    case "created":
      return "Campaign created";
    case "pledged":
      return "New pledge received";
    case "claimed":
      return "Creator claimed vault";
    case "refunded":
      return "Contributor refunded";
    default:
      return event.eventType;
  }
}

export function CampaignTimeline({ history }: CampaignTimelineProps) {
  if (history.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={History}
        title="Timeline"
        message="No activity yet. Events will appear here as campaigns are created and pledged."
      />
    );
  }

  return (
    <section className="card">
      <div className="section-heading">
        <h2>Timeline</h2>
        <p className="muted">
          Each action is stored locally so contributors can follow campaign
          activity.
        </p>
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={History}
          title="No events yet"
          message="Campaign activity will appear here after create, pledge, claim, or refund actions."
        />
      ) : (
        <div className="timeline">
          {[...history].reverse().map((event) => {
            const isPending = event.metadata?.pending === true;
            const txHash =
              typeof event.metadata?.txHash === "string"
                ? event.metadata.txHash
                : event.blockchainMetadata?.txHash;

            return (
              <article
                key={event.id}
                className={`timeline-item ${isPending ? "pending" : ""}`}
              >
                <div className="timeline-dot" aria-hidden />
                <div className="timeline-copy">
                  <strong>
                    {describeEvent(event)}
                    {isPending ? " (pending)" : ""}
                  </strong>
                  <span className="muted">
                    {formatTimestamp(event.timestamp)}
                  </span>
                  <span className="muted">
                    {event.actor
                      ? `Actor: ${event.actor.slice(0, 12)}...`
                      : "System event"}
                    {typeof event.amount === "number"
                      ? ` | Amount: ${event.amount}`
                      : ""}
                  </span>
                  {txHash ? (
                    <span className="mono muted">Tx hash: {txHash}</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
