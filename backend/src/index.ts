import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { config, walletIntegrationReady } from "./config";
import {
  addPledge,
  calculateProgress,
  CampaignStatus,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignWithProgress,
  initCampaignStore,
  listCampaigns,
  reconcileOnChainPledge,
  refundContributor,
} from "./services/campaignStore";
import { checkDbHealth } from "./services/db";
import { getCampaignHistory } from "./services/eventHistory";
import { startEventIndexer } from "./services/eventIndexer";
import { fetchOpenIssues } from "./services/openIssues";
import { ensureSorobanRefundConfig, verifyRefundTransaction } from "./services/sorobanRpc";
import { AppError, ApiErrorResponse, RequestWithId, CampaignListItem } from "./types/errors";
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  paginationSchema,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";
import { logError, logInfo, logRequest } from "./logger";

export const app = express();

const CAMPAIGN_STATUSES: CampaignStatus[] = ["open", "funded", "claimed", "failed"];
const CONTRACT_AMOUNT_DECIMALS = Number(process.env.CONTRACT_AMOUNT_DECIMALS ?? 2);


app.use(
  cors({
    origin: (origin, callback) => {
      const isDev = process.env.NODE_ENV !== "production";
      if (!origin || config.corsAllowedOrigins.includes(origin) || (isDev && config.corsAllowedOrigins.length === 0)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

app.use(express.json());

app.use((req: Request, res: Response, next: express.NextFunction) => {
  const requestWithId = req as RequestWithId;
  requestWithId.requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logRequest(
      {
        requestId: requestWithId.requestId,
        method: req.method,
        path: req.originalUrl || req.path,
        status: res.statusCode,
        durationMs,
      },
      config.logLevel,
    );
  });

  next();
});

function sendValidationError(issues: z.ZodIssue[]): never {
  throw new AppError(
    zodIssuesToErrorMessage(issues),
    400,
    "VALIDATION_ERROR",
    zodIssuesToValidationIssues(issues),
  );
}

function parseCampaignId(
  campaignIdRaw: unknown,
): { ok: true; value: string } | { ok: false; issues: z.ZodIssue[] } {
  if (typeof campaignIdRaw !== "string") {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          message: "Campaign ID must be a string.",
          path: ["id"],
        },
      ],
    };
  }

  const parsed = campaignIdSchema.safeParse(campaignIdRaw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }

  return { ok: true, value: parsed.data };
}

export function normalizeQueryValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function normalizeAssetFilter(assetRaw: unknown): string | undefined {
  const asset = normalizeQueryValue(assetRaw)?.toUpperCase();
  if (!asset) {
    return undefined;
  }

  return config.allowedAssets.includes(asset) ? asset : undefined;
}

export function normalizeStatusFilter(statusRaw: unknown): CampaignStatus | undefined {
  const status = normalizeQueryValue(statusRaw)?.toLowerCase();
  if (!status) {
    return undefined;
  }

  return CAMPAIGN_STATUSES.includes(status as CampaignStatus)
    ? (status as CampaignStatus)
    : undefined;
}

export function parseCampaignListFilters(query: {
  asset?: unknown;
  status?: unknown;
  q?: unknown;
}): {
  asset?: string;
  status?: CampaignStatus;
  searchQuery?: string;
} {
  return {
    asset: normalizeAssetFilter(query.asset),
    status: normalizeStatusFilter(query.status),
    searchQuery: normalizeQueryValue(query.q),
  };
}

export function filterCampaignList(
  campaigns: CampaignListItem[],
  filters: {
    asset?: string;
    status?: CampaignStatus;
  },
): CampaignListItem[] {
  return campaigns.filter((campaign) => {
    const matchesAsset = !filters.asset || campaign.assetCode.toUpperCase() === filters.asset;
    const matchesStatus = !filters.status || campaign.progress.status === filters.status;

    return matchesAsset && matchesStatus;
  });
}

app.get("/api/health", (_req: Request, res: Response) => {
  const database = checkDbHealth();
  const healthy = database.reachable;

  res.status(healthy ? 200 : 503).json({
    service: "stellar-goal-vault-backend",
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    database,
  });
});

app.get("/api/campaigns", (req: Request, res: Response) => {
  const paginationResult = paginationSchema.safeParse({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationResult.success) {
    sendValidationError(paginationResult.error.issues);
  }

  const filters = parseCampaignListFilters({
    asset: req.query.asset,
    status: req.query.status,
    q: req.query.q,
  });
  const { page, limit } = paginationResult.data;
  const { campaigns, totalCount } = listCampaigns({
    searchQuery: filters.searchQuery,
    assetCode: filters.asset,
    status: filters.status,
    page,
    limit,
  });

  const data = filterCampaignList(
    campaigns.map((campaign) => ({
      ...campaign,
      progress: calculateProgress(campaign),
    })),
    filters,
  );

  res.json({
    data,
    pagination: {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
});

app.get("/api/campaigns/:id", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaignWithProgress(parsedId.value);
  if (!campaign) {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  res.json({ data: campaign });
});

app.post("/api/campaigns", (req: Request, res: Response) => {
  const parsedBody = createCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
  }

  if (parsedBody.data.deadline <= Math.floor(Date.now() / 1000)) {
    throw new AppError("deadline must be in the future.", 400, "INVALID_DEADLINE");
  }

  const campaign = createCampaign(parsedBody.data);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/pledges", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const parsedBody = createPledgePayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
  }

  const campaign = addPledge(parsedId.value, parsedBody.data);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/pledges/reconcile", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const parsedBody = reconcilePledgePayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
  }

  const campaign = reconcileOnChainPledge(parsedId.value, parsedBody.data);
  res.status(201).json({
    data: {
      campaign: { ...campaign, progress: calculateProgress(campaign) },
      transactionHash: parsedBody.data.transactionHash,
    },
  });
});

app.post("/api/campaigns/:id/claim", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const parsedBody = claimCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
  }

  const campaign = claimCampaign(parsedId.value, {
    creator: parsedBody.data.creator,
    transactionHash: parsedBody.data.transactionHash,
    confirmedAt: parsedBody.data.confirmedAt,
  });
  res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post("/api/campaigns/:id/refund", async (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const parsedBody = refundPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
  }

  ensureSorobanRefundConfig();
  const verified = await verifyRefundTransaction(parsedBody.data.soroban.txHash);
  const result = refundContributor(parsedId.value, parsedBody.data.contributor, {
    ...parsedBody.data.soroban,
    txHash: verified.txHash,
    ledger: verified.ledger ?? parsedBody.data.soroban.ledger,
    createdAt: verified.createdAt ?? parsedBody.data.soroban.createdAt,
    latestLedger: verified.latestLedger ?? parsedBody.data.soroban.latestLedger,
    source: "soroban-contract",
  });

  res.json({
    data: {
      ...result.campaign,
      progress: calculateProgress(result.campaign),
      refundedAmount: result.refundedAmount,
    },
  });
});

app.get("/api/campaigns/:id/history", (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError("Campaign not found.", 404, "NOT_FOUND");
  }

  res.json({ data: getCampaignHistory(parsedId.value) });
});

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  const data = await fetchOpenIssues();
  res.json({ data });
});

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    data: {
      allowedAssets: config.allowedAssets,
      soroban: {
        enabled: walletIntegrationReady,
        contractId: config.contractId || undefined,
        networkPassphrase: config.sorobanNetworkPassphrase,
        rpcUrl: config.sorobanRpcUrl,
      },
      sorobanRpcUrl: config.sorobanRpcUrl,
      contractId: config.contractId,
      networkPassphrase: config.sorobanNetworkPassphrase,
      contractAmountDecimals: CONTRACT_AMOUNT_DECIMALS,
      walletIntegrationReady,
    },
  });
});

app.use((err: any, req: Request, res: Response, _next: express.NextFunction) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "CORS policy violation",
        requestId: (req as any).requestId,
      },
    });
  }

  const statusCode = err instanceof AppError ? err.statusCode : (err.statusCode ?? 500);
  const code = err instanceof AppError ? err.code : (err.code ?? "INTERNAL_SERVER_ERROR");
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: err.message || "An unexpected error occurred",
      requestId: (req as RequestWithId).requestId,
    },
  };

  if (err instanceof AppError && err.details) {
    response.error.details = err.details;
  } else if (err.details) {
    response.error.details = err.details;
  }

  logError(
    err,
    {
      event: "request_error",
      requestId: (req as RequestWithId).requestId,
      method: req.method,
      path: req.originalUrl || req.path,
      status: statusCode,
      code,
    },
    config.logLevel,
  );

  res.status(statusCode).json(response);
});

function startServer() {
  initCampaignStore();
  startEventIndexer();
  app.listen(config.port, () => {
    logInfo(
      "server_started",
      {
        message: `Stellar Goal Vault API listening on http://localhost:${config.port}`,
        port: config.port,
      },
      config.logLevel,
    );
  });
}

if (require.main === module) {
  startServer();
}
