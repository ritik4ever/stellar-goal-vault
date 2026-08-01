import compression from 'compression';
import cors from 'cors';
import 'dotenv/config';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { createServer, Server } from 'node:http';

import { validateEnv } from './validateEnv';
import { z } from 'zod';
import path from 'path';
import { config, walletIntegrationReady } from './config';
import { apiKeyAuthMiddleware } from './middleware/apiKeyAuth';
import { cacheMiddleware } from './middleware/cacheMiddleware';
import { requestIdMiddleware } from './middleware/requestId';
import { validateBody } from './middleware/validateBody';
import type { RequestWithId } from './middleware/types';
import { initRedisCache } from './services/cache';

import swaggerUi from 'swagger-ui-express';

import {
  addPledge,
  calculateProgress,
  CampaignProgress,
  CampaignRecord,
  CampaignSortField,
  CampaignStatus,
  claimCampaign,
  createCampaign,
  createComment,
  deleteComment,
  getCampaign,
  getCampaignWithProgress,
  getContributorSummary,
  getGlobalStats,
  getTrendingCampaigns,
  getTopContributors,
  initCampaignStore,
  listCampaignPledges,
  listCampaigns,
  listComments,
  type ListCampaignsOptions,
  reconcileOnChainPledge,
  refundContributor,
  restoreCampaign,
  softDeleteCampaign,
  SortOrder,
} from './services/campaignStore';
import { checkDbHealth } from './services/db';
import { getCampaignTimeline, listCampaignHistory } from './services/eventHistory';
import { startEventIndexer } from './services/eventIndexer';
import {
  listNotifications,
  getUnreadCount,
  markAllRead,
} from './services/notificationService';
import { getDeadLetterQueue, clearDeadLetterQueue, retryDeadLetter } from './services/webhookService';
import { fetchOpenIssues } from './services/openIssues';
import { ensureSorobanRefundConfig, verifyRefundTransaction } from './services/sorobanRpc';
import { AppError, ApiErrorResponse } from './types/errors';
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  commentIdSchema,
  createCampaignPayloadSchema,
  createCommentPayloadSchema,
  createPledgePayloadSchema,
  deleteCommentPayloadSchema,
  parseCommentListPaginationQuery,
  parseHistoryPaginationQuery,
  parsePledgeListPaginationQuery,
  parseTimelineQuery,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
  parseCampaignListQuery,
  normalizeQueryValue,
} from './validation/schemas';
import { generateOpenApiDocument } from './openapi';
import { logError, logInfo, logger } from './logger';
import {
  buildCampaignCacheKey,
  getCampaignCacheEntry,
  getTrendingCacheEntry,
  setTrendingCacheEntry,
  invalidateCampaignCache,
  setCampaignCacheEntry,
} from './services/campaignCache';export const app = express();

type CampaignListItem = CampaignRecord & { progress: CampaignProgress };

const CAMPAIGN_STATUSES: CampaignStatus[] = ['open', 'funded', 'claimed', 'failed'];
const CONTRACT_AMOUNT_DECIMALS = Number(process.env.CONTRACT_AMOUNT_DECIMALS ?? 2);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);
const RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.RATE_LIMIT_READ_LIMIT ?? process.env.RATE_LIMIT_MAX_REQUESTS ?? 120,
);
const WRITE_RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.RATE_LIMIT_WRITE_LIMIT ?? process.env.WRITE_RATE_LIMIT_MAX_REQUESTS ?? 20,
);
const CAMPAIGN_DETAIL_PLEDGE_PREVIEW_LIMIT = 5;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
      },
    },
  }),
);

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
    exposedHeaders: [
      'X-Total-Count',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
  }),
);

app.use(compression({ threshold: 1024 }));

const bodySizeLimit = process.env.MAX_BODY_SIZE || '16kb';
app.use(express.json({ limit: bodySizeLimit }));

// OpenAPI documentation endpoints are public and bypass API middleware.
const openApiDocument = generateOpenApiDocument();
app.get('/api/openapi.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(openApiDocument);
});
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/docs', swaggerUi.setup(openApiDocument, { explorer: true }));
  app.use('/api/docs', swaggerUi.serve);
} else {
  app.get('/api/docs', (_req: Request, res: Response) => {
    res.sendStatus(404);
  });
}

// Add API key authentication middleware (production only)
if (process.env.NODE_ENV === 'production') {
  app.use(apiKeyAuthMiddleware);
}

// Add cache middleware for GET requests (production only, 5 minute TTL)
if (process.env.NODE_ENV === 'production') {
  app.use(cacheMiddleware(300));
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function applyRateLimit(limitOverride?: number) {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const rateLimitedReq = req as Request & { rateLimitedProcessed?: boolean };
    if (rateLimitedReq.rateLimitedProcessed) {
      return next();
    }
    rateLimitedReq.rateLimitedProcessed = true;

    // Skip rate limiting when client IP is unavailable (common in test environments)
    if (!req.ip) {
      return next();
    }

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const maxRequests =
      limitOverride ?? (isWrite ? WRITE_RATE_LIMIT_MAX_REQUESTS : RATE_LIMIT_MAX_REQUESTS);

    const key = `${req.ip}:${isWrite ? 'write' : 'read'}`;
    const now = Date.now();
    const current = rateLimitBuckets.get(key);

    let count = 1;
    let resetAt = now + RATE_LIMIT_WINDOW_MS;

    if (current && now < current.resetAt) {
      count = current.count + 1;
      resetAt = current.resetAt;
    }

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (current && now < current.resetAt && current.count >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      throw new AppError('Rate limit exceeded. Please retry shortly.', 429, 'RATE_LIMITED');
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
  const VALID_SORT_FIELDS: CampaignSortField[] = [
    'createdAt',
    'deadline',
    'pledgedAmount',
    'targetAmount',
  ];
  const VALID_ORDERS: SortOrder[] = ['asc', 'desc'];
  const rawSort = normalizeQueryValue(query.sort);
  const rawOrder = normalizeQueryValue(query.order);

  if (rawSort && !VALID_SORT_FIELDS.includes(rawSort as CampaignSortField)) {
    throw new AppError(
      `Invalid sort field: ${rawSort}. Supported fields: ${VALID_SORT_FIELDS.join(', ')}`,
      400,
      'INVALID_SORT_FIELD',
    );
  }
  if (rawOrder && !VALID_ORDERS.includes(rawOrder as SortOrder)) {
    throw new AppError(
      `Invalid sort order: ${rawOrder}. Supported orders: ${VALID_ORDERS.join(', ')}`,
      400,
      'INVALID_SORT_ORDER',
    );
  }

  return {
    asset: normalizeAssetFilter(query.asset),
    status: normalizeStatusFilter(query.status),
    searchQuery: normalizeQueryValue(query.search) || normalizeQueryValue(query.q),
    includeDeleted: query.includeDeleted === 'true',
    sort: rawSort as CampaignSortField | undefined,
    order: rawOrder as SortOrder | undefined,
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

app.get('/api/health/deep', applyRateLimit(1000), async (_req: Request, res: Response) => {
  try {
    const database = checkDbHealth();
    const hasContractId = !!config.contractId;
    let sorobanHealthy = false;

    try {
      if (config.sorobanRpcUrl) {
        const response = await fetch(config.sorobanRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getHealth',
            id: 1,
          }),
          signal: AbortSignal.timeout(5000),
        });
        sorobanHealthy = response.ok || response.status < 500;
      }
    } catch {
      sorobanHealthy = false;
    }

    const allHealthy = database.reachable && hasContractId && sorobanHealthy;

    res.status(allHealthy ? 200 : 503).json({
      overall: allHealthy ? 'up' : 'down',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      components: {
        db: {
          status: database.reachable ? 'up' : 'down',
          details: database.reachable ? 'SQLite database reachable' : database.error,
        },
        soroban: {
          status: sorobanHealthy ? 'up' : 'down',
          details: config.sorobanRpcUrl
            ? 'Soroban RPC reachable'
            : 'Soroban RPC URL not configured',
        },
        contract: {
          status: hasContractId ? 'up' : 'down',
          details: hasContractId ? 'CONTRACT_ID configured' : 'CONTRACT_ID not set',
        },
      },
    });
  } catch (error) {
    res.status(503).json({
      overall: 'down',
      timestamp: new Date().toISOString(),
      error: 'Deep health check failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/campaigns', async (req: Request, res: Response, next: express.NextFunction) => {
  try {
  const queryResult = parseCampaignListQuery(req.query as Record<string, unknown>);
  if (!queryResult.ok) {
    sendValidationError(queryResult.issues);
  }

  const params = queryResult.data;

  // Build a stable cache key from the sorted query string
  const qs = Object.keys(req.query as Record<string, unknown>)
    .sort()
    .map((k) => `${k}=${(req.query as Record<string, unknown>)[k]}`)
    .join('&');
  const cacheKey = buildCampaignCacheKey(qs);

  const cached = await getCampaignCacheEntry(cacheKey);
  if (cached) {
    const cachedData = JSON.parse(cached);
    res.setHeader('Cache-Control', 'max-age=30');
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Total-Count', String(cachedData.pagination.total));
    res.setHeader('Content-Type', 'application/json');
    res.send(cached);
    return;
  }

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

  const { campaigns, totalCount } = listCampaigns(listOptions);

  const data = campaigns.map((campaign) => ({
    ...campaign,
    progress: calculateProgress(campaign),
  }));

  const page = params.page ?? 1;
  const limit = params.limit ?? totalCount;
  const totalPages =
    params.limit === undefined || limit <= 0 ? 1 : Math.max(1, Math.ceil(totalCount / limit));

  const responseBody = JSON.stringify({
    data,
    pagination: {
      total: totalCount,
      page,
      limit,
      totalPages,
    },
  });

  await setCampaignCacheEntry(cacheKey, responseBody);

  res.setHeader('Cache-Control', 'max-age=30');
  res.setHeader('X-Cache', 'MISS');
  res.setHeader('X-Total-Count', String(totalCount));
  res.setHeader('Content-Type', 'application/json');
  res.send(responseBody);
  } catch (error) {
    next(error);
  }
});

app.get('/api/campaigns/trending', (req: Request, res: Response) => {
  const cached = getTrendingCacheEntry();
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', 'application/json');
    res.send(cached);
    return;
  }

  const campaigns = getTrendingCampaigns(10);

  const responseBody = JSON.stringify({
    data: campaigns,
  });

  setTrendingCacheEntry(responseBody);

  res.setHeader('X-Cache', 'MISS');
  res.setHeader('Content-Type', 'application/json');
  res.send(responseBody);
});

app.get('/api/campaigns/:id', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

    const cacheKey = `campaigns:detail:${parsedId.value}`;
    const cached = await getCampaignCacheEntry(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'max-age=30');
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Content-Type', 'application/json');
      res.send(cached);
      return;
    }

    const campaign = getCampaignWithProgress(parsedId.value, CAMPAIGN_DETAIL_PLEDGE_PREVIEW_LIMIT);
    if (!campaign) {
      throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
    }

    const responseBody = JSON.stringify({ data: campaign });
    await setCampaignCacheEntry(cacheKey, responseBody);

    res.setHeader('Cache-Control', 'max-age=30');
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Content-Type', 'application/json');
    res.send(responseBody);
  } catch (error) {
    next(error);
  }
});

app.delete(
  '/api/campaigns/:id',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  (req: Request, res: Response) => {
    const parsedId = parseCampaignId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(parsedId.issues);
    }

    const campaign = softDeleteCampaign(parsedId.value);
    invalidateCampaignCache();
    res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
  },
);

app.post(
  '/api/campaigns/:id/restore',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  (req: Request, res: Response) => {
    const parsedId = parseCampaignId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(parsedId.issues);
    }

    const campaign = restoreCampaign(parsedId.value);
    invalidateCampaignCache();
    res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
  },
);

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
  const totalPages = Math.max(1, Math.ceil(totalCount / paginationResult.limit));

  res.setHeader('X-Total-Count', String(totalCount));
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

app.post(
  '/api/campaigns',
  validateBody(createCampaignPayloadSchema),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
    const body = req.body as z.infer<typeof createCampaignPayloadSchema>;

    if (body.deadline <= Math.floor(Date.now() / 1000)) {
      throw new AppError('deadline must be in the future.', 400, 'INVALID_DEADLINE');
    }

    const campaignInput = {
      ...body,
      maxPerContributor:
        body.maxPerContributor ??
        (config.defaultMaxPerContributor > 0 ? config.defaultMaxPerContributor : undefined),
    };

    const campaign = createCampaign(campaignInput);
    await invalidateCampaignCache();
    res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/campaigns/:id/pledges',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  idempotencyMiddleware,
  validateBody(createPledgePayloadSchema),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
    const parsedId = parseCampaignId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(parsedId.issues);
    }

    const body = req.body as z.infer<typeof createPledgePayloadSchema>;
    const campaign = addPledge(parsedId.value, body);
    await invalidateCampaignCache();
    res.status(201).json({ data: { ...campaign, progress: calculateProgress(campaign) } });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/campaigns/:id/pledges/reconcile',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  validateBody(reconcilePledgePayloadSchema),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
    const parsedId = parseCampaignId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(parsedId.issues);
    }

    const body = req.body as z.infer<typeof reconcilePledgePayloadSchema>;
    const result = reconcileOnChainPledge(parsedId.value, body);
    invalidateCampaignCache();
    res.status(result.existing ? 200 : 201).json({
      data: {
        campaign: { ...result.campaign, progress: calculateProgress(result.campaign) },
        transactionHash: body.transactionHash,
      },
    });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/campaigns/:id/claim',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  validateBody(claimCampaignPayloadSchema),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
    const parsedId = parseCampaignId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(parsedId.issues);
    }

    const body = req.body as z.infer<typeof claimCampaignPayloadSchema>;
    const campaign = claimCampaign(parsedId.value, {
      creator: body.creator,
      transactionHash: body.transactionHash,
      confirmedAt: body.confirmedAt,
    });
    await invalidateCampaignCache();
    res.json({ data: { ...campaign, progress: calculateProgress(campaign) } });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  '/api/campaigns/:id/refund',
  applyRateLimit(WRITE_RATE_LIMIT_MAX_REQUESTS),
  validateBody(refundPayloadSchema),
  async (req: Request, res: Response, next: express.NextFunction) => {
    try {
      const parsedId = parseCampaignId(req.params.id);
      if (!parsedId.ok) {
        sendValidationError(parsedId.issues);
      }

      const body = req.body as z.infer<typeof refundPayloadSchema>;
      ensureSorobanRefundConfig();
      const verified = await verifyRefundTransaction(body.soroban.txHash);
      const result = refundContributor(parsedId.value, body.contributor, {
        ...body.soroban,
        txHash: verified.txHash,
        ledger: verified.ledger ?? body.soroban.ledger,
        createdAt: verified.createdAt ?? body.soroban.createdAt,
        latestLedger: verified.latestLedger ?? body.soroban.latestLedger,
        source: 'soroban-contract',
      });
      await invalidateCampaignCache();

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

app.get('/api/campaigns/:id/timeline', (req: Request, res: Response) => {
  const parsedId = parseCampaignId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(parsedId.issues);
  }

  const campaign = getCampaign(parsedId.value);
  if (!campaign) {
    throw new AppError('Campaign not found.', 404, 'NOT_FOUND');
  }

  const parsed = parseTimelineQuery(req.query);
  if (!parsed.ok) {
    sendValidationError(parsed.issues);
  }

  const result = getCampaignTimeline(parsedId.value, {
    cursor: parsed.cursor,
    limit: parsed.limit,
  });

  res.json({ data: result.data, pagination: { nextCursor: result.nextCursor, hasMore: result.hasMore } });
});

app.get('/api/open-issues', async (_req: Request, res: Response) => {
  const data = await fetchOpenIssues();
  res.json({ data });
});

const ASSET_METADATA: Record<string, { name: string, icon_url: string, min_pledge: number, max_pledge: number }> = {
  USDC: { name: 'USD Coin', icon_url: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png', min_pledge: 1, max_pledge: 10000 },
  XLM: { name: 'Stellar Lumens', icon_url: 'https://cryptologos.cc/logos/stellar-xlm-logo.png', min_pledge: 10, max_pledge: 100000 },
  ARS: { name: 'Argentine Peso', icon_url: '', min_pledge: 1000, max_pledge: 10000000 },
};

const supportedAssetsCache = config.allowedAssets.map((code) => {
  const meta = ASSET_METADATA[code] || { name: code, icon_url: '', min_pledge: 0, max_pledge: 0 };
  return {
    code,
    name: meta.name,
    contract_address: config.assetAddresses[code] || '',
    icon_url: meta.icon_url,
    min_pledge: meta.min_pledge,
    max_pledge: meta.max_pledge,
  };
});

app.get('/api/assets', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.json({ data: supportedAssetsCache });
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

app.get('/api/stats', cacheMiddleware(60), (_req: Request, res: Response) => {
  const stats = getGlobalStats();
  res.json({
    data: {
      total_campaigns: stats.totalCampaigns,
      open_campaigns: stats.campaignCountByStatus.open,
      funded_campaigns: stats.campaignCountByStatus.funded,
      failed_campaigns: stats.campaignCountByStatus.failed,
      total_pledged_usdc: stats.totalPledgedUsdc,
      total_pledged_xlm: stats.totalPledgedXlm,
      total_contributors: stats.totalContributors,
      avg_funding_rate_pct: stats.avgFundingRatePct,
      totalCampaigns: stats.totalCampaigns,
      openCampaigns: stats.campaignCountByStatus.open,
      fundedCampaigns: stats.campaignCountByStatus.funded,
      claimedCampaigns: stats.campaignCountByStatus.claimed,
      failedCampaigns: stats.campaignCountByStatus.failed,
      totalPledgeVolume: stats.totalPledgedAmount,
      uniqueContributors: stats.totalContributors,
    },
  });
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

// ── Notification Routes ───────────────────────────────────────────────────────

app.get('/api/notifications', (req: Request, res: Response) => {
  const wallet = normalizeQueryValue(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_WALLET', message: 'wallet query parameter is required' },
    });
  }
  const rawLimit = normalizeQueryValue(req.query.limit);
  const rawOffset = normalizeQueryValue(req.query.offset);
  const limit = rawLimit ? Math.min(Math.max(1, Number(rawLimit)), 100) : 50;
  const offset = rawOffset ? Math.max(0, Number(rawOffset)) : 0;

  const result = listNotifications(wallet, { limit, offset });
  const unreadCount = getUnreadCount(wallet);
  res.json({ data: result.data, total: result.total, unreadCount });
});

app.get('/api/notifications/unread-count', (req: Request, res: Response) => {
  const wallet = normalizeQueryValue(req.query.wallet);
  if (!wallet) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_WALLET', message: 'wallet query parameter is required' },
    });
  }
  const unreadCount = getUnreadCount(wallet);
  res.json({ unreadCount });
});

app.post('/api/notifications/mark-all-read', (req: Request, res: Response) => {
  const { wallet } = req.body as { wallet?: string };
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_WALLET', message: 'wallet is required in request body' },
    });
  }
  markAllRead(wallet);
  res.json({ success: true });
});

app.get('/api/webhooks/dead-letter', (req: Request, res: Response) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const entries = getDeadLetterQueue(limit);
  res.json({ success: true, data: entries });
});

app.delete('/api/webhooks/dead-letter', (_req: Request, res: Response) => {
  clearDeadLetterQueue();
  res.json({ success: true, message: 'Dead-letter queue cleared' });
});

app.post('/api/webhooks/dead-letter/:id/retry', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid dead-letter ID' },
    });
  }
  const success = await retryDeadLetter(id);
  if (success) {
    res.json({ success: true, message: 'Webhook retried successfully' });
  } else {
    res.status(500).json({
      success: false,
      error: { code: 'WEBHOOK_RETRY_FAILED', message: 'Failed to retry webhook delivery' },
    });
  }
});

function isErrorWithMessage(error: unknown): error is { message: string; [key: string]: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

function isErrorWithType(error: unknown, type: string): boolean {
  return typeof error === 'object' && error !== null && (error as { type?: string }).type === type;
}

app.use((err: unknown, req: Request, res: Response, next: express.NextFunction) => {
  void next;
  if (isErrorWithType(err, 'entity.too.large')) {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds the ${bodySizeLimit} maximum limit.`, 
        requestId: (req as RequestWithId).requestId,
      },
    });
  }

  if (isErrorWithMessage(err) && err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'CORS policy violation',
        requestId: (req as RequestWithId).requestId,
      },
    });
  }

  const errorWithCode = err as { statusCode?: number; code?: string };
  const statusCode = err instanceof AppError ? err.statusCode : (errorWithCode.statusCode ?? 500);
  const code = err instanceof AppError ? err.code : (errorWithCode.code ?? 'INTERNAL_SERVER_ERROR');
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: isErrorWithMessage(err) ? err.message : 'An unexpected error occurred',
      requestId: (req as RequestWithId).requestId,
    },
  };

  if (err instanceof AppError && err.details) {
    response.error.details = err.details;
  } else {
    const errorWithDetails = err as { details?: ApiErrorResponse['error']['details'] };
    if (errorWithDetails.details) {
      response.error.details = errorWithDetails.details;
    }
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

  logInfo(
    'startup_banner',
    {
      message: 'Stellar Goal Vault Backend - Starting Up',
      port: config.port,
      environment: nodeEnv,
      databasePath: dbPath,
    },
    config.logLevel,
  );
}

export function configureHttpServer(server: Server): Server {
  server.keepAliveTimeout = config.keepAliveTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;

  return server;
}

let isShuttingDown = false;

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

  // Reject new requests during shutdown
  app.use((req, res, next) => {
    if (isShuttingDown) {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Server is shutting down',
        },
      });
      return;
    }
    next();
  });

  const server = configureHttpServer(createServer(app));

  const gracefulShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logInfo('server_shutting_down', { signal }, config.logLevel);

    // Stop accepting new connections
    server.close(() => {
      logInfo('server_closed', { message: 'Server closed' }, config.logLevel);
      process.exit(0);
    });

    // Force shutdown after grace period
    const gracePeriodSeconds = 10;
    const gracePeriodTimer = setTimeout(() => {
      logError(
        new Error('Graceful shutdown timeout exceeded'),
        { event: 'graceful_shutdown_timeout', gracePeriodSeconds },
        config.logLevel,
      );
      process.exit(1);
    }, gracePeriodSeconds * 1000);

    // Close the database connection when shutting down
    gracePeriodTimer.unref();
  };

  // Handle graceful shutdown
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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

  return server;
}

if (require.main === module) {
  startServer();
}
