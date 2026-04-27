import { useEffect, useMemo, useState } from "react";
import { CampaignDetailPanel } from "./components/CampaignDetailPanel";
import { FundedConfetti } from "./components/FundedConfetti";
import { KeyboardShortcutsOverlay } from "./components/KeyboardShortcutsOverlay";
import { CampaignsTable } from "./components/CampaignsTable";
import { CampaignTimeline } from "./components/CampaignTimeline";
import { CreateCampaignForm } from "./components/CreateCampaignForm";
import { CreatorAnalytics } from "./components/CreatorAnalytics";
import { IssueBacklog } from "./components/IssueBacklog";
import {
  TransactionPreviewModal,
  TransactionPreviewData,
} from "./components/TransactionPreviewModal";
import { ToastContainer } from "./components/ToastContainer";
import { WalletWidget } from "./components/WalletWidget";
import {
  claimCampaign,
  createCampaign,
  getAppConfig,
  getCampaign,
  getCampaignHistory,
  listCampaigns,
  listOpenIssues,
  reconcilePledge,
  refundCampaign,
  softDeleteCampaign,
} from "./services/api";
import {
  submitFreighterClaim,
  submitFreighterPledge,
  watchFreighterAccount,
} from "./services/freighter";
import { submitRefundTransaction } from "./services/soroban";
import { useFreighter } from "./hooks/useFreighter";
import { useToast } from "./hooks/useToast";
import { didCampaignBecomeFunded } from "./lib/fundingCelebration";
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

type TransactionPreviewState = {
  data: TransactionPreviewData;
  resolve: (approved: boolean) => void;
};

type ConfettiBurst = {
  id: number;
  campaignTitle: string;
};

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
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
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
  const freighter = useFreighter();
  const { toasts, addToast, dismiss } = useToast();
  const connectedWallet = freighter.publicKey;

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
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode());
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingPledgeCampaignId, setPendingPledgeCampaignId] = useState<string | null>(
    null,
  );
  const [invalidUrlCampaignId, setInvalidUrlCampaignId] = useState<string | null>(null);
  const [transactionPreview, setTransactionPreview] = useState<TransactionPreviewState | null>(
    null,
  );
  const [confettiBurst, setConfettiBurst] = useState<ConfettiBurst | null>(null);

  const handleTransactionPreview = (data: TransactionPreviewData): Promise<boolean> => {
    return new Promise((resolve) => {
      setTransactionPreview({ data, resolve });
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    setCampaignIdInUrl(selectedCampaignId);
  }, [selectedCampaignId]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setIsShortcutsOpen((current) => !current);
      }

      if (event.key === "Escape") {
        setIsShortcutsOpen(false);
        if (transactionPreview) {
          transactionPreview.resolve(false);
          setTransactionPreview(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [transactionPreview]);

  async function refreshCampaigns(nextSelectedId?: string | null): Promise<Campaign[]> {
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

      return data;
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
  }, [addToast]);

  useEffect(() => {
    void refreshSelectedData(selectedCampaignId).catch((error) => {
      addToast(getErrorMessage(error), "error");
    });
  }, [addToast, selectedCampaignId]);

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
    setIsConnectingWallet(true);
    try {
      const key = await freighter.connect(networkPassphrase);
      if (key) {
        addToast(`Wallet connected: ${key.slice(0, 16)}...`, "success");
      }
    } finally {
      setIsConnectingWallet(false);
    }
  }

  function handleDisconnectWallet() {
    freighter.disconnect();
    addToast("Wallet disconnected.", "success");
  }

  useEffect(() => {
    if (!connectedWallet) return;
    const stop = watchFreighterAccount((address) => {
      if (address && address !== connectedWallet) {
        addToast(`Switched to ${address.slice(0, 16)}...`, "success");
      } else if (!address) {
        addToast("Wallet disconnected.", "success");
      }
    });
    return stop;
  }, [connectedWallet, addToast]);

  async function handlePledge(campaignId: string, amount: number, assetCode: string) {
    if (!connectedWallet) {
      addToast("Connect Freighter before submitting a pledge.", "error");
      return;
    }

    if (!appConfig) {
      addToast("App configuration is still loading. Try again in a moment.", "error");
      return;
    }

    const previousCampaign =
      campaigns.find((campaign) => campaign.id === campaignId) ??
      (selectedCampaign?.id === campaignId ? selectedCampaign : null);

    setPendingPledgeCampaignId(campaignId);

    try {
      const transactionResult = await submitFreighterPledge({
        campaignId,
        contributor: connectedWallet,
        amount,
        assetCode,
        config: appConfig,
        onPreview: handleTransactionPreview,
      });

      await reconcilePledge(campaignId, {
        contributor: connectedWallet,
        amount,
        assetCode,
        transactionHash: transactionResult.transactionHash,
        confirmedAt: transactionResult.confirmedAt,
      });

      const refreshedCampaigns = await refreshCampaigns(campaignId);
      const refreshedCampaign =
        refreshedCampaigns.find((campaign) => campaign.id === campaignId) ?? null;

      if (didCampaignBecomeFunded(previousCampaign, refreshedCampaign)) {
        setConfettiBurst({
          id: Date.now(),
          campaignTitle: refreshedCampaign?.title ?? "Campaign",
        });
      }

      await refreshSelectedData(campaignId);
      addToast("Pledge confirmed on-chain and reconciled.", "success");
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: string }).code === "USER_CANCELLED") {
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
      if (error && typeof error === "object" && (error as { code?: string }).code === "USER_CANCELLED") {
        return;
      }
      addToast(getErrorMessage(error), "error");
    }
  }

  async function handleSoftDelete(campaignId: string) {
    if (!window.confirm(`Soft delete campaign #${campaignId}? Data preserved, hidden from lists.`)) {
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
      {confettiBurst ? (
        <FundedConfetti
          key={confettiBurst.id}
          campaignTitle={confettiBurst.campaignTitle}
          onComplete={() => setConfettiBurst(null)}
        />
      ) : null}

      <section className="hero animate-fade-in">
        <div className="hero-topline">
          <div>
            <div className="eyebrow">Stellar Goal Vault</div>
            <h1>Campaign control center</h1>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <WalletWidget
              status={freighter.status}
              publicKey={freighter.publicKey}
              error={freighter.error}
              onConnect={() => {
                void handleConnectWallet();
              }}
            />
            <button className="btn-ghost" type="button" onClick={handleThemeToggle}>
              {themeMode === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button className="btn-ghost" type="button" onClick={() => setIsShortcutsOpen(true)}>
              Shortcuts
            </button>
          </div>
        </div>
        <p className="hero-copy">
          Create campaigns, manage pledges, and track funding milestones as they
          move through the Stellar goal vault lifecycle.
        </p>
        {actionError ? <p className="form-error">{actionError.message}</p> : null}
        {actionMessage ? <p className="form-success">{actionMessage}</p> : null}
      </section>

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
          onDisconnectWallet={handleDisconnectWallet}
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

      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {transactionPreview ? (
        <TransactionPreviewModal
          preview={transactionPreview.data}
          onConfirm={() => {
            transactionPreview.resolve(true);
            setTransactionPreview(null);
          }}
          onCancel={() => {
            transactionPreview.resolve(false);
            setTransactionPreview(null);
          }}
        />
      ) : null}

      <KeyboardShortcutsOverlay
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}

export default App;
