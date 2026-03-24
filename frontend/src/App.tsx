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
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignDetails, setSelectedCampaignDetails] = useState<Campaign | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(null);

  async function refreshCampaigns(nextSelectedId?: string | null) {
    const data = await listCampaigns();
    setCampaigns(data);

    const candidateId =
      nextSelectedId ?? selectedCampaignId ?? (data.length > 0 ? data[0].id : null);
    const exists = data.some((campaign) => campaign.id === candidateId);
    setSelectedCampaignId(exists ? candidateId : data[0]?.id ?? null);
  }

  async function refreshHistory(campaignId: string | null) {
    if (!campaignId) {
      setHistory([]);
      return;
    }

    const data = await getCampaignHistory(campaignId);
    setHistory(data);
  }

  async function refreshSelectedCampaign(campaignId: string | null) {
    if (!campaignId) {
      setSelectedCampaignDetails(null);
      return;
    }
    const campaign = await getCampaign(campaignId);
    setSelectedCampaignDetails(campaign);
  }

  useEffect(() => {
    async function bootstrap() {
      const [campaignData, issueData] = await Promise.all([
        listCampaigns(),
        listOpenIssues(),
      ]);

      setCampaigns(campaignData);
      setIssues(issueData);
      setSelectedCampaignId(campaignData[0]?.id ?? null);
    }

    void bootstrap();
  }, []);

  useEffect(() => {
    setSelectedCampaignDetails(null);
    void Promise.all([refreshHistory(selectedCampaignId), refreshSelectedCampaign(selectedCampaignId)]);
  }, [selectedCampaignId]);

  const selectedCampaign = useMemo(() => {
    const baseCampaign =
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
    if (!baseCampaign) {
      return null;
    }
    if (selectedCampaignDetails?.id !== baseCampaign.id) {
      return baseCampaign;
    }
    return {
      ...baseCampaign,
      pledges: selectedCampaignDetails.pledges,
    };
  }, [campaigns, selectedCampaignDetails, selectedCampaignId]);

  const metrics = useMemo(() => {
    const open = campaigns.filter((campaign) => campaign.progress.status === "open").length;
    const funded = campaigns.filter((campaign) => campaign.progress.status === "funded").length;
    const pledged = campaigns.reduce((sum, campaign) => sum + campaign.pledgedAmount, 0);

    return {
      total: campaigns.length,
      open,
      funded,
      pledged: Number(pledged.toFixed(2)),
    };
  }, [campaigns]);

  async function handleCreate(payload: Parameters<typeof createCampaign>[0]) {
    setCreateError(null);
    setActionError(null);
    setActionMessage(null);

    try {
      const campaign = await createCampaign(payload);
      await refreshCampaigns(campaign.id);
      await Promise.all([refreshHistory(campaign.id), refreshSelectedCampaign(campaign.id)]);
      setActionMessage(`Campaign #${campaign.id} is live and ready for pledges.`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create campaign.");
    }
  }

  async function handlePledge(campaignId: string, contributor: string, amount: number) {
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

    setCampaigns((currentCampaigns) =>
      currentCampaigns.map((campaign) =>
        campaign.id === campaignId ? toOptimisticPledgedCampaign(campaign, amount) : campaign,
      ),
    );
    setSelectedCampaignDetails((currentDetails) => {
      if (!currentDetails || currentDetails.id !== campaignId) {
        return currentDetails;
      }
      const optimisticPledge = {
        id: -Date.now(),
        campaignId,
        contributor,
        amount,
        createdAt: optimisticTimestamp,
      };
      return {
        ...toOptimisticPledgedCampaign(currentDetails, amount),
        pledges: [optimisticPledge, ...(currentDetails.pledges ?? [])],
      };
    });
    setPendingPledgeCampaignId(campaignId);
    if (selectedCampaignId === campaignId) {
      setHistory((currentHistory) => [optimisticEvent, ...currentHistory]);
    }
    setActionMessage("Submitting pledge...");

    const pendingStartedAt = Date.now();
    const minimumPendingMs = 800;

    try {
      await addPledge(campaignId, { contributor, amount });
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) {
        await delay(minimumPendingMs - elapsedMs);
      }
      await refreshCampaigns(campaignId);
      await Promise.all([refreshHistory(campaignId), refreshSelectedCampaign(campaignId)]);
      setPendingPledgeCampaignId(null);
      setActionMessage("Pledge recorded in the local goal vault.");
    } catch (error) {
      const elapsedMs = Date.now() - pendingStartedAt;
      if (elapsedMs < minimumPendingMs) {
        await delay(minimumPendingMs - elapsedMs);
      }
      setCampaigns(previousCampaigns);
      setSelectedCampaignDetails(previousSelectedDetails);
      await refreshSelectedCampaign(campaignId);
      if (selectedCampaignId === campaignId) {
        setHistory(previousHistory);
      }
      setPendingPledgeCampaignId(null);
      setActionError(error instanceof Error ? error.message : "Failed to add pledge.");
      setActionMessage(null);
    }
  }

  async function handleClaim(campaign: Campaign) {
    setActionError(null);
    setActionMessage(null);

    try {
      await claimCampaign(campaign.id, campaign.creator);
      await refreshCampaigns(campaign.id);
      await Promise.all([refreshHistory(campaign.id), refreshSelectedCampaign(campaign.id)]);
      setActionMessage("Campaign claimed successfully.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to claim campaign.");
    }
  }

  async function handleRefund(campaignId: string, contributor: string) {
    setActionError(null);
    setActionMessage(null);

    try {
      await refundCampaign(campaignId, contributor);
      await refreshCampaigns(campaignId);
      await Promise.all([refreshHistory(campaignId), refreshSelectedCampaign(campaignId)]);
      setActionMessage("Refund recorded for the selected contributor.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to refund contributor.");
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban crowdfunding MVP</p>
        <h1>Stellar Goal Vault</h1>
        <p className="hero-copy">
          Create funding goals, collect pledges, and model claim or refund flows before
          wiring the full Soroban transaction path.
        </p>
      </header>

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
          onPledge={handlePledge}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </section>

      <CampaignsTable
        campaigns={campaigns}
        selectedCampaignId={selectedCampaignId}
        onSelect={setSelectedCampaignId}
      />

      <section className="secondary-grid">
        <CampaignTimeline history={history} />
        <IssueBacklog issues={issues} />
      </section>
    </div>
  );
}

export default App;
