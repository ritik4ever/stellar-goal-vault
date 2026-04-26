
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { KeyboardShortcutsOverlay } from "./components/KeyboardShortcutsOverlay";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { CreatorAnalytics } from "./components/CreatorAnalytics";
import { IssueBacklog } from "./components/IssueBacklog";
import { TransactionPreviewModal, TransactionPreviewData } from "./components/TransactionPreviewModal";
import { ToastContainer } from "./components/ToastContainer";
import { WalletWidget } from "./components/WalletWidget";
import {
  claimCampaign,
  createCampaign,
  getAppConfig,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  softDeleteCampaign,
  listOpenIssues,
  reconcilePledge,
  refundCampaign,
} from "./services/api";
import {
  submitFreighterClaim,
  submitFreighterPledge,
} from "./services/freighter";
import { submitRefundTransaction } from "./services/soroban";
import { useFreighter } from "./hooks/useFreighter";
import { useToast } from "./hooks/useToast";
import {
  ApiError,
  AppConfig,
  Campaign,
  CampaignEvent,
  OpenIssue,
} from "./types/campaign";

const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const THEME_STORAGE_KEY = "stellar-goal-vault-theme";
type ThemeMode = "light" | "dark";

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

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybeError = error as Error;
    return maybeError.message || "Something went wrong.";
  }
  if (typeof error === "string") {
    return error;
  }
  return "Something went wrong.";
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

function getInitialThemeMode(): ThemeMode {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(
    null,
  );
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<string | null>(null);



  const handleTransactionPreview = (data: TransactionPreviewData): Promise<boolean> => {
    return new Promise((resolve) => {
      setTransactionPreview({ data, resolve });
    });
  };

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
        addToast(getErrorMessage(configResult.reason), "error");
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
        addToast(getErrorMessage(campaignsResult.reason), "error");
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
      addToast(getErrorMessage(error), "error");
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

    try {
      const campaign = await createCampaign(payload);
      await refreshCampaigns(campaign.id);
      await refreshSelectedData(campaign.id);
      addToast(`Campaign #${campaign.id} is live and ready for pledges.`, "success");
    } catch (error) {
      setCreateError(toApiError(error));
    }
  }

  async function handleConnectWallet() {
    const networkPassphrase = appConfig?.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE;
    const key = await freighter.connect(networkPassphrase);
    if (key) {
      addToast(`Wallet connected: ${key.slice(0, 16)}...`, "success");
    }
  }

  async function handlePledge(campaignId: string, amount: number) {
    if (!connectedWallet) {
      addToast("Connect Freighter before submitting a pledge.", "error");
      return;
    }

    setPendingPledgeCampaignId(campaignId);

    try {

      }

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

      addToast("Pledge confirmed on-chain and reconciled.", "success");

      await refreshCampaigns(campaignId);
      await refreshSelectedData(campaignId);
    } catch (error) {
      if (error && typeof error === "object" && (error as any).code === "USER_CANCELLED") {
        return;
      }
      addToast(getErrorMessage(error), "error");
    } finally {
      setPendingPledgeCampaignId(null);
    }
  }

  async function handleClaim(campaign: Campaign) {
    if (!appConfig?.walletIntegrationReady) {
      addToast("Wallet signing is not configured on the backend yet.", "error");
      return;
    }

    if (!connectedWallet) {
      addToast("Connect Freighter before claiming campaign funds.", "error");
      return;
    }

    if (connectedWallet !== campaign.creator) {
      addToast("Only the campaign creator can claim funds.", "error");
      return;
    }

    try {
      const transactionResult = await submitFreighterClaim({
        campaignId: campaign.id,
        creator: connectedWallet,
        config: appConfig,
        onPreview: handleTransactionPreview,
      });

      await claimCampaign(
        campaign.id,
        connectedWallet,
        transactionResult.transactionHash,
        transactionResult.confirmedAt,
      );

      await refreshCampaigns(campaign.id);
      await refreshSelectedData(campaign.id);
      addToast("Campaign claimed successfully.", "success");
    } catch (error) {
      if (error && typeof error === "object" && (error as any).code === "USER_CANCELLED") {
        return;
      }
      addToast(getErrorMessage(error), "error");
    }
  }


  }

  if (!confirm(`Soft delete campaign #${campaignId}? Data preserved, hidden from lists.`)) {
    return;
  }

  setActionError(null);
  setActionMessage("Soft deleting...");

  try {
    await softDeleteCampaign(campaignId);
    await refreshCampaigns();
    setActionMessage("Campaign soft deleted.");
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

  function handleThemeToggle() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  }

  return (
    <div className="app-shell">


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
          isPledgePending={pendingPledgeCampaignId === selectedCampaignId}
          isLoading={isSelectedLoading || initialLoad}
          onConnectWallet={handleConnectWallet}
          onPledge={handlePledge}
          onClaim={handleClaim}
          onSoftDelete={handleSoftDelete}
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
