import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useFreighter } from "../hooks/useFreighter";
import { useToast } from "../hooks/useToast";
import { getUserPledges, refundCampaign } from "../services/api";
import { submitRefundTransaction } from "../services/soroban";
import { UserPledgeSummary } from "../types/campaign";
import { WalletWidget } from "../components/WalletWidget";
import { ErrorBoundary } from "../components/ErrorBoundary";

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function BackerDashboard() {
  const freighter = useFreighter();
  const { addToast } = useToast();
  const [summaries, setSummaries] = useState<UserPledgeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refundPendingId, setRefundPendingId] = useState<string | null>(null);

  const connectedWallet = freighter.publicKey;

  useEffect(() => {
    if (!connectedWallet) {
      setSummaries([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    getUserPledges(connectedWallet)
      .then((data) => {
        if (!cancelled) {
          setSummaries(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          addToast(error instanceof Error ? error.message : "Failed to load pledges", "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectedWallet, addToast]);

  const metrics = useMemo(() => {
    let pledged = 0;
    let refunded = 0;
    for (const summary of summaries) {
      pledged += summary.totalPledged;
      refunded += summary.totalRefunded;
    }
    return {
      pledged: round(pledged),
      refunded: round(refunded),
      net: round(pledged - refunded),
    };
  }, [summaries]);

  const handleRefund = async (campaignId: string) => {
    if (!connectedWallet) return;
    setRefundPendingId(campaignId);
    try {
      addToast("Preparing refund transaction...", "success");
      const sorobanReceipt = await submitRefundTransaction(campaignId, connectedWallet);
      await refundCampaign(campaignId, connectedWallet, sorobanReceipt);
      addToast("Refund successful.", "success");
      
      // Refresh
      const data = await getUserPledges(connectedWallet);
      setSummaries(data);
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setRefundPendingId(null);
    }
  };

  if (!connectedWallet) {
    return (
      <div className="app-shell">
        <section className="hero animate-fade-in">
          <div className="hero-topline">
            <div>
              <div className="eyebrow">Backer Dashboard</div>
              <h1>My Pledges</h1>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Link to="/" className="btn-ghost" style={{ textDecoration: 'none' }}>Back to Home</Link>
              <WalletWidget
                status={freighter.status}
                publicKey={freighter.publicKey}
                error={freighter.error}
                onConnect={() => freighter.connect("Test SDF Network ; September 2015")}
              />
            </div>
          </div>
          <p className="hero-copy">Connect your wallet to view your pledges.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <section className="hero animate-fade-in">
        <div className="hero-topline">
          <div>
            <div className="eyebrow">Backer Dashboard</div>
            <h1>My Pledges</h1>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link to="/" className="btn-ghost" style={{ textDecoration: 'none' }}>Back to Home</Link>
            <WalletWidget
              status={freighter.status}
              publicKey={freighter.publicKey}
              error={freighter.error}
              onConnect={() => {}}
            />
          </div>
        </div>
        <p className="hero-copy">Track your investments, active pledges, and claimable refunds.</p>
      </section>

      <section className="metric-grid animate-fade-in">
        <article className="metric-card">
          <span>Total Pledged</span>
          <strong>{metrics.pledged}</strong>
        </article>
        <article className="metric-card">
          <span>Total Refunded</span>
          <strong>{metrics.refunded}</strong>
        </article>
        <article className="metric-card">
          <span>Net Invested</span>
          <strong>{metrics.net}</strong>
        </article>
      </section>

      <section className="layout-grid animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Pledging Activity</h2>
          {isLoading ? (
            <p>Loading pledges...</p>
          ) : summaries.length === 0 ? (
            <p>You haven't backed any campaigns yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="campaigns-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Total Pledged</th>
                    <th>Total Refunded</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(summary => {
                    const canRefund = summary.campaign.progress.status === 'failed' && summary.totalPledged > 0;
                    return (
                      <tr key={summary.campaign.id}>
                        <td>
                          <strong><Link to={`/campaigns/${summary.campaign.id}`}>{summary.campaign.title}</Link></strong>
                        </td>
                        <td>
                          <span className={`status-badge status-${summary.campaign.progress.status}`}>
                            {summary.campaign.progress.status}
                          </span>
                        </td>
                        <td>{round(summary.totalPledged)}</td>
                        <td>{round(summary.totalRefunded)}</td>
                        <td>
                          {canRefund && (
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() => handleRefund(summary.campaign.id)}
                              disabled={refundPendingId === summary.campaign.id}
                            >
                              {refundPendingId === summary.campaign.id ? 'Refunding...' : 'Quick Refund'}
                            </button>
                          )}
                          {!canRefund && summary.totalRefunded > 0 && <span style={{ color: 'var(--color-success-dim)' }}>Refunded</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
