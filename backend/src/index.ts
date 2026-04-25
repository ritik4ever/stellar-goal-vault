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
  getGlobalStats,
  initCampaignStore,
  listCampaigns,
  type ListCampaignsOptions,
  softDeleteCampaign,
  reconcileOnChainPledge,
  refundContributor,
} from "./services/campaignStore";
import { checkDbHealth } from "./services/db";
import { getCampaignHistory } from "./services/eventHistory";
import { startEventIndexer } from "./services/eventIndexer";
import { fetchOpenIssues } from "./services/openIssues";
import { ensureSorobanRefundConfig, verifyRefundTransaction } from "./services/sorobanRpc";
import { AppError, ApiErrorResponse } from "./types/errors";
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  parseCampaignListPaginationQuery,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";
import { logError, logInfo, logRequest } from "./logger";

export const app = express();

interface RequestWithId extends Request {
  requestId?: string;
}

import { CampaignRecord, CampaignProgress } from "./services/campaignStore";
type CampaignListItem = CampaignRecord & { progress: CampaignProgress };

const CAMPAIGN_STATUSES: CampaignStatus[] = ["open", "funded", "claimed", "failed"];
const CONTRACT_AMOUNT_DECIMALS = Number(process.env.CONTRACT_AMOUNT_DECIMALS ?? 2);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const WRITE_RATE_LIMIT_MAX_REQUESTS = 40;


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

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function applyRateLimit(maxRequests: number) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const key = `${req.ip}:${req.path}:${maxRequests}`;
    const now = Date.now();
    const current = rateLimitBuckets.get(key);

    if (!current || now >= current.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (current.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      throw new AppError("Rate limit exceeded. Please retry shortly.", 429, "RATE_LIMITED");
    }

    current.count += 1;
    rateLimitBuckets.set(key, current);
    return next();
  };
}

app.use(applyRateLimit(RATE_LIMIT_MAX_REQUESTS));

app.use((req: RequestWithId, res: Response, next: express.NextFunction) => {
  req.requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logRequest(
      {
        requestId: req.requestId,
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
  includeDeleted?: unknown;
}): {
  asset?: string;
  status?: CampaignStatus;
  searchQuery?: string;
  includeDeleted?: boolean;
} {
  return {
    asset: normalizeAssetFilter(query.asset),
    status: normalizeStatusFilter(query.status),
    searchQuery: normalizeQueryValue(query.q),
    includeDeleted: query.includeDeleted === 'true',
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
  const paginationResult = parseCampaignListPaginationQuery({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationResult.ok) {
    sendValidationError(paginationResult.issues);
  }

  const filters = parseCampaignListFilters({
    asset: req.query.asset,
    status: req.query.status,
    q: req.query.q,
    includeDeleted: req.query.includeDeleted,
  });

  const listOptions: ListCampaignsOptions = {
    searchQuery: filters.searchQuery,
    assetCode: filters.asset,
    status: filters.status,
    includeDeleted: filters.includeDeleted,
  };
  if (paginationResult.page !== undefined) {
    listOptions.page = paginationResult.page;
    listOptions.limit = paginationResult.limit;
  }

  const { campaigns, totalCount } = listCampaigns(listOptions);

  const data = filterCampaignList(
    campaigns.map((campaign) => ({
      ...campaign,
      progress: calculateProgress(campaign),
    })),
    filters,
  );

  const page = paginationResult.page ?? 1;
  const limit = paginationResult.limit ?? totalCount;
  const totalPages =
    paginationResult.limit === undefined || limit <= 0
      ? 1
      : Math.max(1, Math.ceil(totalCount / limit));

  res.json({
    data,
    pagination: {
      total: totalCount,
      page,
      limit,
      totalPages,
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

app.post("/api/campaigns/:id/pledges", applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS), (req: Request, res: Response) => {
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

app.post("/api/campaigns/:id/pledges/reconcile", applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS), (req: Request, res: Response) => {
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

app.post("/api/campaigns/:id/claim", applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS), (req: Request, res: Response) => {
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

app.post("/api/campaigns/:id/refund", applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS), async (req: Request, res: Response) => {
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

app.get("/api/stats", (_req: Request, res: Response) => {
  const stats = getGlobalStats();
  res.json({ data: stats });
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
