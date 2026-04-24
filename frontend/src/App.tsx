import { useEffect, useMemo, useState } from "react";
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { CreatorAnalytics } from "./components/CreatorAnalytics";
import { IssueBacklog } from "./components/IssueBacklog";
import {
  addPledge,
  claimCampaign,
  createCampaign,
  getAppConfig,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  listOpenIssues,
  reconcilePledge,
  refundCampaign,
} from "./services/api";
import {
  connectFreighterWallet,
  submitFreighterClaim,
  submitFreighterPledge,
} from "./services/freighter";
import { submitRefundTransaction } from "./services/soroban";
import {
  ApiError,
  AppConfig,
  Campaign,
  CampaignEvent,
  OpenIssue,
} from "./types/campaign";

const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

function round(value: number): number {
  return Number(value.toFixed(2));
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

function toApiError(error: unknown): ApiError {
  if (error && typeof error === "object") {
    const maybeError = error as Error & {
      code?: string;
      details?: Array<{ field: string; message: string }>;
      requestId?: string;
    };

    return {
      message: maybeError.message || "Something went wrong.",
      code: maybeError.code,
      details: maybeError.details,
      requestId: maybeError.requestId,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return { message: "Something went wrong." };
}

function App() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [history, setHistory] = useState<CampaignEvent[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(() =>
    getCampaignIdFromUrl(),
  );
  const [selectedCampaignDetails, setSelectedCampaignDetails] = useState<Campaign | null>(
    null,
  );
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(false);
  const [isIssuesLoading, setIsIssuesLoading] = useState(false);
  const [isSelectedLoading, setIsSelectedLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(
    null,
  );
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<string | null>(null);
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  useEffect(() => {
    setCampaignIdInUrl(selectedCampaignId);
  }, [selectedCampaignId]);

  async function refreshCampaigns(nextSelectedId?: string | null) {
    setIsCampaignsLoading(true);
    try {
      const data = await listCampaigns();
      setCampaigns(data);

      const requestedId = nextSelectedId ?? selectedCampaignId;
      const nextId = requestedId ?? data[0]?.id ?? null;
      const exists = nextId ? data.some((campaign) => campaign.id === nextId) : false;
      const resolvedId = exists ? nextId : data[0]?.id ?? null;

      setInvalidUrlCampaignId(requestedId && !exists ? requestedId : null);
      setSelectedCampaignId(resolvedId);

      if (!resolvedId) {
        setSelectedCampaignDetails(null);
        setHistory([]);
      }
    } finally {
      setIsCampaignsLoading(false);
    }
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

    setIsSelectedLoading(true);
    try {
      const campaign = await getCampaign(campaignId);
      setSelectedCampaignDetails(campaign);
    } finally {
      setIsSelectedLoading(false);
    }
  }

  async function refreshIssues() {
    setIsIssuesLoading(true);
    try {
      const data = await listOpenIssues();
      setIssues(data);
    } finally {
      setIsIssuesLoading(false);
    }
  }

  async function refreshSelectedData(campaignId: string | null) {
    await Promise.all([refreshHistory(campaignId), refreshSelectedCampaign(campaignId)]);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const requestedCampaignId = getCampaignIdFromUrl();
      setInitialLoad(true);

      const [configResult, issuesResult, campaignsResult] = await Promise.allSettled([
        getAppConfig(),
        listOpenIssues(),
        listCampaigns(),
      ]);

      if (cancelled) {
        return;
      }

      if (configResult.status === "fulfilled") {
        setAppConfig(configResult.value);
      } else {
        setActionError(toApiError(configResult.reason));
      }

      if (issuesResult.status === "fulfilled") {
        setIssues(issuesResult.value);
      }

      if (campaignsResult.status === "fulfilled") {
        const data = campaignsResult.value;
        setCampaigns(data);

        const nextId = requestedCampaignId ?? data[0]?.id ?? null;
        const exists = nextId ? data.some((campaign) => campaign.id === nextId) : false;
        const resolvedId = exists ? nextId : data[0]?.id ?? null;

        setInvalidUrlCampaignId(requestedCampaignId && !exists ? requestedCampaignId : null);
        setSelectedCampaignId(resolvedId);
      } else {
        setActionError(toApiError(campaignsResult.reason));
      }

      setInitialLoad(false);
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshSelectedData(selectedCampaignId).catch((error) => {
      setActionError(toApiError(error));
    });
  }, [selectedCampaignId]);

  const selectedCampaign = useMemo(() => {
    const summaryCampaign =
      campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

    if (!summaryCampaign) {
      return selectedCampaignDetails;
    }

    if (!selectedCampaignDetails || selectedCampaignDetails.id !== summaryCampaign.id) {
      return summaryCampaign;
    }

    return {
      ...summaryCampaign,
      pledges: selectedCampaignDetails.pledges,
      metadata: selectedCampaignDetails.metadata ?? summaryCampaign.metadata,
    };
  }, [campaigns, selectedCampaignDetails, selectedCampaignId]);

  const metrics = useMemo(() => {
    const open = campaigns.filter((campaign) => campaign.progress.status === "open").length;
    const funded = campaigns.filter((campaign) => campaign.progress.status === "funded").length;
    const claimed = campaigns.filter((campaign) => campaign.progress.status === "claimed").length;
    const pledged = campaigns.reduce((sum, campaign) => sum + campaign.pledgedAmount, 0);

    return {
      total: campaigns.length,
      open,
      funded,
      claimed,
      pledged: round(pledged),
    };
  }, [campaigns]);

  async function handleCreate(payload: Parameters<typeof createCampaign>[0]) {
    setCreateError(null);
    setActionError(null);
    setActionMessage(null);

    try {
      const campaign = await createCampaign(payload);
      await refreshCampaigns(campaign.id);
      await refreshSelectedData(campaign.id);
      setActionMessage(`Campaign #${campaign.id} is live and ready for pledges.`);
    } catch (error) {
      setCreateError(toApiError(error));
    }
  }

  async function handleConnectWallet() {
    setActionError(null);
    setActionMessage(null);
    setIsConnectingWallet(true);

    try {
      const wallet = await connectFreighterWallet(
        appConfig?.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE,
      );
      setConnectedWallet(wallet.publicKey);
      setActionMessage(`Connected wallet ${wallet.publicKey}.`);
    } catch (error) {
      setActionError(toApiError(error));
    } finally {
      setIsConnectingWallet(false);
    }
  }

  async function handlePledge(campaignId: string, amount: number) {
    if (!connectedWallet) {
      setActionError({
        message: "Connect Freighter before submitting a pledge.",
        code: "WALLET_REQUIRED",
      });
      return;
    }

    setActionError(null);
    setActionMessage(null);
    setPendingPledgeCampaignId(campaignId);

    try {
      if (appConfig?.walletIntegrationReady && appConfig.contractId && appConfig.sorobanRpcUrl) {
        setActionMessage("Submitting pledge to Soroban...");
        const transactionResult = await submitFreighterPledge({
          campaignId,
          contributor: connectedWallet,
          amount,
          config: appConfig,
        });

        await reconcilePledge(campaignId, {
          contributor: connectedWallet,
          amount,
          transactionHash: transactionResult.transactionHash,
          confirmedAt: transactionResult.confirmedAt,
        });

        setActionMessage("Pledge confirmed on-chain and reconciled locally.");
      } else {
        setActionMessage(
          "Wallet signing is not configured on the backend yet. Recording the pledge locally.",
        );
        await addPledge(campaignId, { contributor: connectedWallet, amount });
        setActionMessage("Pledge recorded in the local goal vault.");
      }

      await refreshCampaigns(campaignId);
      await refreshSelectedData(campaignId);
    } catch (error) {
      setActionError(toApiError(error));
      setActionMessage(null);
    } finally {
      setPendingPledgeCampaignId(null);
    }
  }

  async function handleClaim(campaign: Campaign) {
    if (!appConfig?.walletIntegrationReady) {
      setActionError({
        message: "Wallet signing is not configured on the backend yet.",
        code: "CONFIG_MISSING",
      });
      return;
    }

    if (!connectedWallet) {
      setActionError({
        message: "Connect Freighter before claiming campaign funds.",
        code: "WALLET_REQUIRED",
      });
      return;
    }

    if (connectedWallet !== campaign.creator) {
      setActionError({
        message: "Only the campaign creator can claim funds.",
        code: "FORBIDDEN",
      });
      return;
    }

    setActionError(null);
    setActionMessage("Submitting claim to Soroban...");

    try {
      const transactionResult = await submitFreighterClaim({
        campaignId: campaign.id,
        creator: connectedWallet,
        config: appConfig,
      });

      await claimCampaign(
        campaign.id,
        connectedWallet,
        transactionResult.transactionHash,
        transactionResult.confirmedAt,
      );

      await refreshCampaigns(campaign.id);
      await refreshSelectedData(campaign.id);
      setActionMessage("Campaign claimed successfully.");
    } catch (error) {
      setActionError(toApiError(error));
      setActionMessage(null);
    }
  }

  async function handleRefund(campaignId: string, contributor: string) {
    setActionError(null);
    setActionMessage("Preparing Soroban refund transaction...");

    try {
      const sorobanReceipt = await submitRefundTransaction(campaignId, contributor);
      await refundCampaign(campaignId, contributor, sorobanReceipt);
      await refreshCampaigns(campaignId);
      await refreshSelectedData(campaignId);
      setActionMessage("Contributor refunded successfully.");
    } catch (error) {
      setActionError(toApiError(error));
      setActionMessage(null);
    }
  }

  function handleSelect(campaignId: string) {
    setInvalidUrlCampaignId(null);
    setSelectedCampaignId(campaignId);
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Soroban crowdfunding MVP</p>
        <h1>Stellar Goal Vault</h1>
        <p className="hero-copy">
          Create funding goals, collect pledges, and reconcile claim and refund flows
          against the backend contract integration.
        </p>
      </header>

      <section className="metric-grid animate-fade-in">
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
          <span>Claimed campaigns</span>
          <strong>{metrics.claimed}</strong>
        </article>
        <article className="metric-card">
          <span>Total pledged</span>
          <strong>{metrics.pledged}</strong>
        </article>
      </section>

      {selectedCampaign && (
        <section
          className="animate-fade-in"
          style={{ animationDelay: "0.1s" }}
        >
          <CreatorAnalytics
            creatorAddress={selectedCampaign.creator}
            campaigns={campaigns}
            isLoading={isCampaignsLoading || initialLoad}
          />
        </section>
      )}

      <section
        className="layout-grid animate-fade-in"
        style={{ animationDelay: "0.2s" }}
      >
        <CreateCampaignForm
          onCreate={handleCreate}
          apiError={createError}
          allowedAssets={appConfig?.allowedAssets ?? []}
        />
        <CampaignDetailPanel
          campaign={selectedCampaign}
          appConfig={appConfig}
          connectedWallet={connectedWallet}
          isConnectingWallet={isConnectingWallet}
          actionError={actionError}
          actionMessage={actionMessage}
          isPledgePending={pendingPledgeCampaignId === selectedCampaignId}
          isLoading={isSelectedLoading || initialLoad}
          onConnectWallet={handleConnectWallet}
          onPledge={handlePledge}
          onClaim={handleClaim}
          onRefund={handleRefund}
        />
      </section>

      <section className="secondary-grid">
        <CampaignsTable
          campaigns={campaigns}
          selectedCampaignId={selectedCampaignId}
          onSelect={handleSelect}
          isLoading={isCampaignsLoading || initialLoad}
          invalidUrlCampaignId={invalidUrlCampaignId}
        />
        <CampaignTimeline history={history} isLoading={isSelectedLoading || initialLoad} />
      </section>

      <section className="section-margin">
        <IssueBacklog issues={issues} isLoading={isIssuesLoading} />
      </section>
    </div>
  );
}

export default App;
