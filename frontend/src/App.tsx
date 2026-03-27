import { useEffect, useMemo, useState } from "react";
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { IssueBacklog } from "./components/IssueBacklog";
import {
  addPledge,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  listOpenIssues,
  refundCampaign,
} from "./services/api";
import { Campaign, CampaignEvent, OpenIssue } from "./types/campaign";

function round(value: number): number {
  return Number(value.toFixed(2));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCampaignIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("campaign");
}

function setCampaignIdInUrl(campaignId: string | null): void {
  const url = new URL(window.location.href);
  if (campaignId) {
    url.searchParams.set("campaign", campaignId);
  } else {
    url.searchParams.delete("campaign");
  }
  window.history.replaceState(null, "", url.toString());
}

function toOptimisticPledgedCampaign(campaign: Campaign, amount: number): Campaign {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const nextPledgedAmount = round(campaign.pledgedAmount + amount);
  const deadlineReached = nowInSeconds >= campaign.deadline;
  const status =
    campaign.claimedAt !== undefined
      ? "claimed"
      : nextPledgedAmount >= campaign.targetAmount
        ? "funded"
        : deadlineReached
          ? "failed"
          : "open";

  return {
    ...campaign,
    pledgedAmount: nextPledgedAmount,
    progress: {
      ...campaign.progress,
      status,
      percentFunded: round((nextPledgedAmount / campaign.targetAmount) * 100),
      remainingAmount: round(Math.max(0, campaign.targetAmount - nextPledgedAmount)),
      pledgeCount: campaign.progress.pledgeCount + 1,
      canPledge: campaign.claimedAt === undefined && !deadlineReached,
      canClaim:
        campaign.claimedAt === undefined &&
        deadlineReached &&
        nextPledgedAmount >= campaign.targetAmount,
      canRefund:
        campaign.claimedAt === undefined &&
        deadlineReached &&
        nextPledgedAmount < campaign.targetAmount,
    },
  };
}

function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [history, setHistory] = useState<CampaignEvent[]>([]);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(false);
  const [isSelectedLoading, setIsSelectedLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignDetails, setSelectedCampaignDetails] = useState<Campaign | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(null);
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<string | null>(null);

  useEffect(() => {
    setCampaignIdInUrl(selectedCampaignId);
  }, [selectedCampaignId]);

  async function refreshCampaigns(nextSelectedId?: string | null) {
    const startedAt = Date.now();
    setIsCampaignsLoading(true);
    try {
      const data = await listCampaigns();
      setCampaigns(data);

      const candidateId =
        nextSelectedId ?? selectedCampaignId ?? (data.length > 0 ? data[0].id : null);
      const exists = data.some((campaign) => campaign.id === candidateId);
      setSelectedCampaignId(exists ? candidateId : data[0]?.id ?? null);
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 300;
      if (elapsed < minMs) await delay(minMs - elapsed);
      setIsCampaignsLoading(false);
    }
  }

  async function refreshHistory(campaignId: string | null) {
    if (!campaignId) {
      setHistory([]);
      return;
    }

  }

  async function refreshSelectedCampaign(campaignId: string | null) {
    if (!campaignId) {
      setSelectedCampaignDetails(null);
      return;
    }
    const startedAt = Date.now();
    setIsSelectedLoading(true);
    try {
      const campaign = await getCampaign(campaignId);
      setSelectedCampaignDetails(campaign);
    } finally {
      const elapsed = Date.now() - startedAt;
      const minMs = 200;
      if (elapsed < minMs) await delay(minMs - elapsed);
      setIsSelectedLoading(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {

      }
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    setSelectedCampaignDetails(null);
    void Promise.all([
      refreshHistory(selectedCampaignId),
      refreshSelectedCampaign(selectedCampaignId),
    ]);
  }, [selectedCampaignId]);

  // ── derived state ────────────────────────────────────────────────────────

  const selectedCampaign = useMemo(() => {
    const baseCampaign =
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
    if (!baseCampaign) return null;
    if (selectedCampaignDetails?.id !== baseCampaign.id) return baseCampaign;
    return { ...baseCampaign, pledges: selectedCampaignDetails.pledges };
  }, [campaigns, selectedCampaignDetails, selectedCampaignId]);

  const metrics = useMemo(() => {
    const open = campaigns.filter((c) => c.progress.status === "open").length;
    const funded = campaigns.filter((c) => c.progress.status === "funded").length;
    const pledged = campaigns.reduce((sum, c) => sum + c.pledgedAmount, 0);
    return {
      total: campaigns.length,
      open,
      funded,
      pledged: Number(pledged.toFixed(2)),
    };
  }, [campaigns]);

  // ── action handlers ──────────────────────────────────────────────────────

  async function handleCreate(payload: Parameters<typeof createCampaign>[0]) {
    setCreateError(null);
    setActionError(null);
    setActionMessage(null);

    try {
      const campaign = await createCampaign(payload);
      await refreshCampaigns(campaign.id);
      await Promise.all([
        refreshHistory(campaign.id),
        refreshSelectedCampaign(campaign.id),
      ]);
      setActionMessage(`Campaign #${campaign.id} is live and ready for pledges.`);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create campaign.",
      );
    }
  }

  async function handlePledge(
    campaignId: string,
    contributor: string,
    amount: number,
  ) {
    setActionError(null);
    setActionMessage(null);

    const previousCampaigns = campaigns;
    const previousHistory = history;
    const previousSelectedDetails = selectedCampaignDetails;
    const optimisticTimestamp = Math.floor(Date.now() / 1000);
    const optimisticEvent: CampaignEvent = {
      id: -Date.now(),
      campaignId,
      eventType: "pledged",
      timestamp: optimisticTimestamp,
      actor: contributor,
      amount,
      metadata: { pending: true },
    };

    setCampaigns((current) =>
      current.map((c) =>
        c.id === campaignId ? toOptimisticPledgedCampaign(c, amount) : c,
      ),
    );
    setSelectedCampaignDetails((current) => {
      if (!current || current.id !== campaignId) return current;
      const optimisticPledge = {
        id: -Date.now(),
        campaignId,
        contributor,
        amount,
        createdAt: optimisticTimestamp,
      };
      return {
        ...toOptimisticPledgedCampaign(current, amount),
        pledges: [optimisticPledge, ...(current.pledges ?? [])],
      };
    });
    setPendingPledgeCampaignId(campaignId);
    if (selectedCampaignId === campaignId) {
      setHistory((current) => [optimisticEvent, ...current]);
    }
    setActionMessage("Submitting pledge...");

    const pendingStartedAt = Date.now();
    const minimumPendingMs = 800;

    try {
      await addPledge(campaignId, { contributor, amount });
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) await delay(minimumPendingMs - elapsedMs);
      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);
      setPendingPledgeCampaignId(null);
      setActionMessage("Pledge recorded in the local goal vault.");
    } catch (error) {
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) await delay(minimumPendingMs - elapsedMs);
      setCampaigns(previousCampaigns);
      setSelectedCampaignDetails(previousSelectedDetails);
      await refreshSelectedCampaign(campaignId);
      if (selectedCampaignId === campaignId) setHistory(previousHistory);
      setPendingPledgeCampaignId(null);
      setActionError(
        error instanceof Error ? error.message : "Failed to add pledge.",
      );
      setActionMessage(null);
    }
  }

  async function handleClaim(campaign: Campaign) {
    setActionError(null);
    setActionMessage(null);
    try {
      await claimCampaign(campaign.id, campaign.creator);
      await refreshCampaigns(campaign.id);
      await Promise.all([
        refreshHistory(campaign.id),
        refreshSelectedCampaign(campaign.id),
      ]);
      setActionMessage("Campaign claimed successfully.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to claim campaign.",
      );
    }
  }

  async function handleRefund(campaignId: string, contributor: string) {
    setActionError(null);
    setActionMessage(null);
    try {
      await refundCampaign(campaignId, contributor);
      await refreshCampaigns(campaignId);
      await Promise.all([
        refreshHistory(campaignId),
        refreshSelectedCampaign(campaignId),
      ]);
      setActionMessage("Refund recorded for the selected contributor.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to refund contributor.",
      );
    }
  }

  /** Called when the user picks a campaign in the table. Clears any
   *  "invalid link" banner since they are now navigating intentionally. */
  function handleSelect(campaignId: string) {
    setInvalidUrlCampaignId(null);
    setSelectedCampaignId(campaignId);
  }

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban crowdfunding MVP</p>
        <h1>Stellar Goal Vault</h1>
        <p className="hero-copy">
          Create funding goals, collect pledges, and model claim or refund flows
          before wiring the full Soroban transaction path.
        </p>
      </header>

      {/* Invalid shared-link banner */}
      {invalidUrlCampaignId && (
        <div className="invalid-campaign-banner" role="alert">
          <strong>Campaign not found.</strong> The link you followed referenced
          campaign&nbsp;<code>{invalidUrlCampaignId}</code>, which doesn't exist or
          may have been removed.
          {campaigns.length > 0 && " Showing the first available campaign instead."}
          <button
            className="btn-ghost invalid-campaign-dismiss"
            type="button"
            onClick={() => setInvalidUrlCampaignId(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <section className="metric-grid">
        <article className="metric-card">
          <span>Total campaigns</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="metric-card">
          <span>Open campaigns</span>
          <strong>{metrics.open}</strong>
        </article>
        <article className="metric-card">
          <span>Funded campaigns</span>
          <strong>{metrics.funded}</strong>
        </article>
        <article className="metric-card">
          <span>Total pledged</span>
          <strong>{metrics.pledged}</strong>
        </article>
      </section>

      <section className="layout-grid">
        <CreateCampaignForm onCreate={handleCreate} apiError={createError} />
        <CampaignDetailPanel
          campaign={selectedCampaign}
          actionError={actionError}
          actionMessage={actionMessage}
          isPledgePending={pendingPledgeCampaignId === selectedCampaignId}
          isLoading={isSelectedLoading || initialLoad}
          onPledge={handlePledge}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </section>

      <CampaignsTable
        campaigns={campaigns}
  isLoading={isCampaignsLoading || initialLoad}
        selectedCampaignId={selectedCampaignId}
        onSelect={handleSelect}
      />

      <section className="secondary-grid">
  <CampaignTimeline history={history} isLoading={isSelectedLoading || initialLoad} />
  <IssueBacklog issues={issues} isLoading={isSelectedLoading || initialLoad} />
      </section>
    </div>
  );
}

export default App;