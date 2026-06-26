import compression from "compression";
import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";

import { validateEnv } from "./validateEnv";
import { z } from "zod";
import path from "path";
import { config, walletIntegrationReady } from "./config";
import { apiKeyAuthMiddleware } from "./middleware/apiKeyAuth";
import { cacheMiddleware } from "./middleware/cacheMiddleware";
import { requestIdMiddleware } from "./middleware/requestId";
import type { RequestWithId } from "./middleware/types";
import { initRedisCache } from "./services/cache";

import {
  addPledge,
  calculateProgress,
  CampaignProgress,
  CampaignRecord,
  CampaignSortField,
  CampaignStatus,
  claimCampaign,
  createCampaign,
  getCampaign,
  getCampaignWithProgress,
  getContributorSummary,
  getGlobalStats,
  getTopContributors,
  initCampaignStore,
  listCampaignPledges,
  listCampaigns,
  type ListCampaignsOptions,
  reconcileOnChainPledge,
  refundContributor,
  SortOrder,
  updateCampaign,
} from './services/campaignStore';
import { checkDbHealth } from './services/db';
import { listCampaignHistory } from './services/eventHistory';
import { startEventIndexer } from './services/eventIndexer';
import { fetchOpenIssues } from './services/openIssues';
import { ensureSorobanRefundConfig, verifyRefundTransaction } from './services/sorobanRpc';
import { AppError, ApiErrorResponse } from './types/errors';
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  parseCampaignListPaginationQuery,
  parseHistoryPaginationQuery,
  parsePledgeListPaginationQuery,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
  parseCampaignListQuery,
  normalizeQueryValue,
} from './validation/schemas';
import { logError, logInfo } from './logger';
export const app = express();

type CampaignListItem = CampaignRecord & { progress: CampaignProgress };

const CAMPAIGN_STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
const CONTRACT_AMOUNT_DECIMALS = Number(process.env.CONTRACT_AMOUNT_DECIMALS ?? 2);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_READ_LIMIT ?? process.env.RATE_LIMIT_MAX_REQUESTS ?? 120);
const WRITE_RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_WRITE_LIMIT ?? process.env.WRITE_RATE_LIMIT_MAX_REQUESTS ?? 20);
const CAMPAIGN_DETAIL_PLEDGE_PREVIEW_LIMIT = 5;

app.use(
  cors({
    origin: (origin, callback) => {
      const isDev = process.env.NODE_ENV !== 'production';
      if (
        !origin ||
        config.corsAllowedOrigins.includes(origin) ||
        config.corsAllowedOrigins.includes('*') ||
        (isDev && config.corsAllowedOrigins.length === 0)
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);

app.use(compression({ threshold: 1024 }));

const bodySizeLimit = process.env.MAX_BODY_SIZE || "16kb";
app.use(express.json({ limit: bodySizeLimit }));

// Add API key authentication middleware (production only)
if (process.env.NODE_ENV === "production") {
  app.use(apiKeyAuthMiddleware);
}

// Add cache middleware for GET requests (production only, 5 minute TTL)
if (process.env.NODE_ENV === "production") {
  app.use(cacheMiddleware(300));
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function applyRateLimit(limitOverride?: number) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    if ((req as any).rateLimitedProcessed) {
      return next();
    }
    (req as any).rateLimitedProcessed = true;

    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
    const maxRequests = limitOverride ?? (isWrite ? WRITE_RATE_LIMIT_MAX_REQUESTS : RATE_LIMIT_MAX_REQUESTS);

    const key = `${req.ip}:${isWrite ? "write" : "read"}`;
    const now = Date.now();
    const current = rateLimitBuckets.get(key);

    let count = 1;
    let resetAt = now + RATE_LIMIT_WINDOW_MS;

    if (current && now < current.resetAt) {
      count = current.count + 1;
      resetAt = current.resetAt;
    }

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, maxRequests - count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (current && now < current.resetAt && current.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      throw new AppError("Rate limit exceeded. Please retry shortly.", 429, "RATE_LIMITED");
    }

    rateLimitBuckets.set(key, { count, resetAt });
    return next();
  };
}

app.use(applyRateLimit());

app.use(requestIdMiddleware);

function sendValidationError(issues: z.ZodIssue[]): never {
  throw new AppError(
    zodIssuesToErrorMessage(issues),
    400,
    'VALIDATION_ERROR',
    zodIssuesToValidationIssues(issues),
  );
}

function parseCampaignId(
  campaignIdRaw: unknown,
): { ok: true; value: string } | { ok: false; issues: z.ZodIssue[] } {
  if (typeof campaignIdRaw !== 'string') {
    return {
      ok: false,
      issues: [
        {
          code: 'custom',
          message: 'Campaign ID must be a string.',
          path: ['id'],
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

export function normalizeAssetFilter(assetRaw: unknown): string | undefined {
  const asset = normalizeQueryValue(assetRaw)?.toUpperCase();
  if (!asset) {
    return undefined;
  }

  return config.allowedAssets.includes(asset) ? asset : undefined;
}

export function normalizeStatusFilter(
  statusRaw: unknown,
): CampaignStatus | undefined {
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
  search?: unknown;
  includeDeleted?: unknown;
  sort?: unknown;
  order?: unknown;
}): {
  asset?: string;
  status?: CampaignStatus;
  searchQuery?: string;
  includeDeleted?: boolean;
  sort?: CampaignSortField;
  order?: SortOrder;
} {
  const VALID_SORT_FIELDS: CampaignSortField[] = ['newest', 'deadline', 'percentFunded', 'totalPledged'];
  const VALID_ORDERS: SortOrder[] = ['asc', 'desc'];
  const rawSort = normalizeQueryValue(query.sort);
  const rawOrder = normalizeQueryValue(query.order);
  return {
    asset: normalizeAssetFilter(query.asset),
    status: normalizeStatusFilter(query.status),
    searchQuery:
      normalizeQueryValue(query.search) || normalizeQueryValue(query.q),
    includeDeleted: query.includeDeleted === "true",
    sort: rawSort && VALID_SORT_FIELDS.includes(rawSort as CampaignSortField) ? (rawSort as CampaignSortField) : undefined,
    order: rawOrder && VALID_ORDERS.includes(rawOrder as SortOrder) ? (rawOrder as SortOrder) : undefined,
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
    const matchesAsset =
      !filters.asset || campaign.assetCode.toUpperCase() === filters.asset;
    const matchesStatus =
      !filters.status || campaign.progress.status === filters.status;

    return matchesAsset && matchesStatus;
  });
}

app.get('/api/health', (_req: Request, res: Response) => {
  const database = checkDbHealth();
  const healthy = database.reachable;

  res.status(healthy ? 200 : 503).json({
    service: 'stellar-goal-vault-backend',
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(3)),
    database,
  });
});

app.get('/api/campaigns', (req: Request, res: Response) => {
  const queryResult = parseCampaignListQuery(req.query as Record<string, unknown>);
  if (!queryResult.ok) {
    sendValidationError(queryResult.issues);
  }

  const params = queryResult.data;

  const listOptions: ListCampaignsOptions = {
    searchQuery: params.search || params.q,
    assetCodes: params.asset,
    status: params.status,
    includeDeleted: params.includeDeleted,
    sort: params.sort,
    order: params.order,
    createdAfter: params.createdAfter,
    createdBefore: params.createdBefore,
  };
  if (params.page !== undefined) {
    listOptions.page = params.page;
    listOptions.limit = params.limit;
  }

  const { campaigns, totalCount, pledgeCounts } = listCampaigns(listOptions);

  const data = campaigns.map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign, undefined, pledgeCounts[campaign.id]),
  }));

  const page = params.page ?? 1;
  const limit = params.limit ?? totalCount;
  const totalPages =
    params.limit === undefined || limit <= 0
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

app.get('/api/campaigns/:id', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaignWithProgress(parsedId.value, CAMPAIGN_DETAIL_PLEDGE_PREVIEW_LIMIT);
  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  res.json({ data: campaign });
});

app.get('/api/campaigns/:id/pledges', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const paginationResult = parsePledgeListPaginationQuery({
    page: req.query.page,
    limit: req.query.limit,
  });
  if (!paginationResult.ok) {
    sendValidationError(paginationResult.issues);
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const { pledges, totalCount } = listCampaignPledges(parsedId.value, {
    page: paginationResult.page,
    limit: paginationResult.limit,
  });
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / paginationResult.limit),
  );

  res.json({
    data: pledges,
    pagination: {
      total: totalCount,
      page: paginationResult.page,
      limit: paginationResult.limit,
      totalPages,
    },
  });
});

app.post('/api/campaigns', (req: Request, res: Response) => {
  const parsedBody = createCampaignPayloadSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(parsedBody.error.issues);
    return;
  }

  if (parsedBody.data.deadline <= Math.floor(Date.now() / 1000)) {
    throw new AppError('deadline must be in the future.', 400, 'INVALID_DEADLINE');
  }

  const campaignInput = {
    ...parsedBody.data,
    maxPerContributor:
      parsedBody.data.maxPerContributor ??
      (config.defaultMaxPerContributor > 0 ? config.defaultMaxPerContributor : undefined),
  };

  const campaign = createCampaign(campaignInput);
  res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
});

app.post(
  '/api/campaigns/:id/pledges',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  (req: Request, res: Response) => {
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
  },
);

app.post(
  '/api/campaigns/:id/pledges/reconcile',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  (req: Request, res: Response) => {
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
  },
);

app.post(
  '/api/campaigns/:id/claim',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  (req: Request, res: Response) => {
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
  },
);

app.post(
  '/api/campaigns/:id/refund',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
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
        source: 'soroban-contract',
      });

      res.json({
        data: {
          ...result.campaign,
          progress: calculateProgress(result.campaign),
          refundedAmount: result.refundedAmount,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get('/api/campaigns/:id/contributors', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const summary = getContributorSummary(parsedId.value);
  res.json({ data: summary });
});

app.get('/api/campaigns/:id/history', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const paginationParsed = parseHistoryPaginationQuery(req.query);
  if (!paginationParsed.ok) {
    sendValidationError(paginationParsed.issues);
  }

  const result = listCampaignHistory(parsedId.value, {
    page: paginationParsed.page,
    pageSize: paginationParsed.pageSize,
  });

  res.json(result);
});

app.get('/api/open-issues', async (_req: Request, res: Response) => {
  const data = await fetchOpenIssues();
  res.json({ data });
});

app.get('/api/config', (_req: Request, res: Response) => {
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
      assetAddresses: config.assetAddresses,
    },
  });
});

app.get('/api/stats', (_req: Request, res: Response) => {
  const stats = getGlobalStats();
  res.json({ data: stats });
});

app.get('/api/leaderboard', (req: Request, res: Response) => {
  try {
    const limitParam = req.query.limit;
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam as string, 10) || 10, 1), 100)
      : 10;

    const leaderboard = getTopContributors(limit);
    res.json({ data: leaderboard });
  } catch (err) {
    logError(
      err as Error,
      {
        event: 'leaderboard_error',
        requestId: (req as RequestWithId).requestId,
      },
      config.logLevel,
    );
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch leaderboard',
        requestId: (req as RequestWithId).requestId,
      },
    });
  }
});

app.use((err: any, req: Request, res: Response, _next: express.NextFunction) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload size exceeds the maximum allowed limit',
        requestId: (req as RequestWithId).requestId,
      },
    });
  }

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'CORS policy violation',
        requestId: (req as RequestWithId).requestId,
      },
    });
  }

  const statusCode = err instanceof AppError ? err.statusCode : (err.statusCode ?? 500);
  const code = err instanceof AppError ? err.code : (err.code ?? 'INTERNAL_SERVER_ERROR');
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: err.message || 'An unexpected error occurred',
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
      event: 'request_error',
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

function printStartupBanner(): void {
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest) {
    return;
  }

  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'campaigns.db');
  const nodeEnv = process.env.NODE_ENV || 'development';

  /* eslint-disable no-console */
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Stellar Goal Vault Backend - Starting Up          ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Port:           ${config.port.toString().padEnd(42)}║`);
  console.log(`║  Environment:    ${nodeEnv.padEnd(42)}║`);
  console.log(`║  Database Path:  ${dbPath.padEnd(42)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  /* eslint-enable no-console */
}

export function configureHttpServer(server: Server): Server {
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;

  return server;
}

function startServer() {
  validateEnv();
  printStartupBanner();
  initCampaignStore();
  startEventIndexer();

  // Initialize Redis cache in production
  if (process.env.NODE_ENV === 'production') {
    initRedisCache().catch((error) => {
      logError(error, { event: 'redis_init_failed' }, config.logLevel);
    });
  }

  const server = configureHttpServer(createServer(app));

  server.listen(config.port, () => {
    logInfo(
      'server_started',
      {
        message: `Stellar Goal Vault API listening on http://localhost:${config.port}`,
        port: config.port,
        keepAliveTimeoutMs: server.keepAliveTimeout,
        headersTimeoutMs: server.headersTimeout,
      },
      config.logLevel,
    );
  });
}

if (require.main === module) {
  startServer();
}
