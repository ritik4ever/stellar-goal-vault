import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { config } from './config';
import {
  campaignIdSchema,
  claimCampaignPayloadSchema,
  createCampaignPayloadSchema,
  createPledgePayloadSchema,
  reconcilePledgePayloadSchema,
  refundPayloadSchema,
} from './validation/schemas';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'API key',
  description: 'Use the API key as a Bearer token in the Authorization header.',
});

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

const stellarAddressSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/)
  .openapi({
    description: 'A 56-character Stellar public key (G...).',
    example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });

const assetCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{1,12}$/)
  .openapi({ description: 'Accepted Stellar asset code.', example: 'USDC' });

const txHashSchema = z
  .string()
  .regex(/^[A-Fa-f0-9]{64}$/)
  .openapi({
    description: 'A 64-character hexadecimal transaction hash.',
    example: 'a'.repeat(64),
  });

const unixTimestampSchema = z.number().int().positive().openapi({
  description: 'Unix timestamp in seconds.',
  example: 1735689600,
});

const paginationSchema = z.object({
  total: z
    .number()
    .int()
    .openapi({ description: 'Total number of items matching the query.', example: 42 }),
  page: z.number().int().openapi({ description: 'Current page (1-based).', example: 1 }),
  limit: z.number().int().openapi({ description: 'Number of items per page.', example: 10 }),
  totalPages: z.number().int().openapi({ description: 'Total number of pages.', example: 5 }),
});

const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    message: z.string().openapi({ example: 'page must be a positive integer.' }),
    details: z
      .array(
        z.object({
          field: z.string().openapi({ example: 'page' }),
          message: z.string().openapi({ example: 'page must be a positive integer.' }),
        }),
      )
      .optional(),
    requestId: z.string().optional().openapi({ example: 'req-123' }),
  }),
});

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

const campaignProgressSchema = z
  .object({
    status: z.enum(['open', 'funded', 'claimed', 'failed']).openapi({ example: 'open' }),
    percentFunded: z.number().openapi({ example: 45.5 }),
    remainingAmount: z.number().openapi({ example: 54.5 }),
    pledgeCount: z.number().int().openapi({ example: 12 }),
    hoursLeft: z.number().openapi({ example: 72 }),
    canPledge: z.boolean().openapi({ example: true }),
    canClaim: z.boolean().openapi({ example: false }),
    canRefund: z.boolean().openapi({ example: false }),
  })
  .openapi('CampaignProgress');

const campaignMetadataSchema = z
  .object({
    imageUrl: z.string().url().optional(),
    externalLink: z.string().url().optional(),
  })
  .optional()
  .openapi({ description: 'Optional campaign media / link metadata.' });

const campaignSchema = z
  .object({
    id: z.string().openapi({ description: 'Numeric campaign identifier.', example: '1' }),
    creator: stellarAddressSchema,
    title: z.string().openapi({ example: 'Clean Water Initiative' }),
    description: z.string().openapi({ example: 'Raising funds to provide clean water access.' }),
    acceptedTokens: z.array(assetCodeSchema).openapi({ example: ['USDC', 'XLM'] }),
    assetCode: assetCodeSchema.openapi({
      description: 'Primary asset code (backward compatibility).',
      example: 'USDC',
    }),
    targetAmount: z.number().positive().openapi({ example: 1000 }),
    pledgedAmount: z.number().openapi({ example: 455 }),
    deadline: unixTimestampSchema,
    createdAt: unixTimestampSchema,
    claimedAt: unixTimestampSchema.optional(),
    failedAt: unixTimestampSchema.optional(),
    deletedAt: unixTimestampSchema.optional(),
    metadata: campaignMetadataSchema,
    maxPerContributor: z.number().int().positive().optional().openapi({ example: 500 }),
    tokenBalances: z
      .record(z.string(), z.number())
      .optional()
      .openapi({ example: { USDC: 455, XLM: 0 } }),
    progress: campaignProgressSchema,
    pledges: z
      .array(
        z.object({
          id: z.number().int(),
          campaignId: z.string(),
          contributor: stellarAddressSchema,
          amount: z.number().positive(),
          assetCode: assetCodeSchema,
          createdAt: unixTimestampSchema,
          refundedAt: unixTimestampSchema.optional(),
          transactionHash: z.string().optional(),
        }),
      )
      .optional()
      .openapi({ description: 'Recent pledges included on campaign detail responses.' }),
  })
  .openapi('Campaign');

const pledgeSchema = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    campaignId: z.string().openapi({ example: '1' }),
    contributor: stellarAddressSchema,
    amount: z.number().positive().openapi({ example: 50 }),
    assetCode: assetCodeSchema,
    createdAt: unixTimestampSchema,
    refundedAt: unixTimestampSchema.optional(),
    transactionHash: z.string().optional(),
  })
  .openapi('Pledge');

const campaignEventSchema = z
  .object({
    id: z.number().int().openapi({ example: 1 }),
    campaignId: z.string().openapi({ example: '1' }),
    eventType: z
      .enum([
        'created',
        'pledged',
        'claimed',
        'refunded',
        'updated',
        'metadata_updated',
        'pledge_limit_reached',
        'archived',
        'restored',
      ])
      .openapi({ example: 'pledged' }),
    timestamp: unixTimestampSchema,
    actor: stellarAddressSchema.optional(),
    amount: z.number().positive().optional().openapi({ example: 50 }),
    metadata: z.record(z.string(), z.unknown()).optional(),
    blockchainMetadata: z
      .object({
        txHash: z.string().optional(),
        ledgerNumber: z.number().int().optional(),
        ledgerCloseTime: z.number().int().optional(),
        eventIndex: z.number().int().optional(),
        contractId: z.string().optional(),
        source: z.enum(['local', 'soroban']).optional(),
      })
      .optional(),
  })
  .openapi('CampaignEvent');

const contributorSummarySchema = z
  .object({
    contributor: stellarAddressSchema,
    totalPledged: z.number().openapi({ example: 150 }),
    refundedAmount: z.number().openapi({ example: 0 }),
    isFullyRefunded: z.boolean().openapi({ example: false }),
  })
  .openapi('ContributorSummary');

const openIssueSchema = z
  .object({
    id: z.string().openapi({ example: 'SGV-1' }),
    title: z.string().openapi({ example: 'Implement Freighter-signed pledge transactions' }),
    labels: z.array(z.string()).openapi({ example: ['enhancement', 'soroban'] }),
    summary: z
      .string()
      .openapi({ example: 'Replace mock API pledges with wallet-signed Soroban transactions.' }),
    complexity: z.enum(['Trivial', 'Medium', 'High']).openapi({ example: 'High' }),
    points: z.number().int().openapi({ example: 200 }),
  })
  .openapi('OpenIssue');

// API Key Management Schemas
const apiKeyScopeSchema = z.enum(['read-only', 'read-write']);

const createApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ example: 'Production API Key' }),
    scope: apiKeyScopeSchema.openapi({ example: 'read-write' }),
    expiresInDays: z.number().int().positive().optional().openapi({ example: 90 }),
  })
  .openapi('CreateApiKeyRequest');

const apiKeyResponseSchema = z
  .object({
    id: z.string().openapi({ example: 'abc123def456' }),
    name: z.string().openapi({ example: 'Production API Key' }),
    keyPrefix: z.string().openapi({ example: 'sk_abc12' }),
    scope: apiKeyScopeSchema,
    createdAt: unixTimestampSchema,
    expiresAt: unixTimestampSchema.nullable(),
    lastUsedAt: unixTimestampSchema.nullable(),
  })
  .openapi('ApiKeyResponse');

const createdApiKeyResponseSchema = z
  .object({
    id: z.string().openapi({ example: 'abc123def456' }),
    name: z.string().openapi({ example: 'Production API Key' }),
    keyPrefix: z.string().openapi({ example: 'sk_abc12' }),
    plainKey: z.string().openapi({ example: 'sk_abc12xyz789...' }),
    scope: apiKeyScopeSchema,
    createdAt: unixTimestampSchema,
    expiresAt: unixTimestampSchema.nullable(),
  })
  .openapi('CreatedApiKeyResponse');

const rotateApiKeyRequestSchema = z
  .object({
    gracePeriodDays: z.number().int().positive().optional().openapi({ example: 7 }),
  })
  .openapi('RotateApiKeyRequest');

// ---------------------------------------------------------------------------
// Request / response envelope schemas
// ---------------------------------------------------------------------------

const createCampaignRequestSchema = createCampaignPayloadSchema.openapi('CreateCampaignPayload');
const createPledgeRequestSchema = createPledgePayloadSchema.openapi('CreatePledgePayload');
const reconcilePledgeRequestSchema = reconcilePledgePayloadSchema.openapi('ReconcilePledgePayload');
const claimCampaignRequestSchema = claimCampaignPayloadSchema.openapi('ClaimCampaignPayload');
const refundRequestSchema = refundPayloadSchema.openapi('RefundPayload');

const campaignIdParamSchema = campaignIdSchema.openapi({
  param: { name: 'id', in: 'path', required: true },
  example: '1',
});

const campaignListResponseSchema = z
  .object({
    data: z.array(campaignSchema),
    pagination: paginationSchema,
  })
  .openapi('CampaignListResponse');

const pledgeListResponseSchema = z
  .object({
    data: z.array(pledgeSchema),
    pagination: paginationSchema,
  })
  .openapi('PledgeListResponse');

const campaignDetailResponseSchema = z
  .object({
    data: campaignSchema,
  })
  .openapi('CampaignDetailResponse');

const campaignHistoryResponseSchema = z
  .object({
    data: z.array(campaignEventSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi('CampaignHistoryResponse');

const healthResponseSchema = z
  .object({
    service: z.string(),
    status: z.enum(['ok', 'degraded']),
    timestamp: z.string().datetime(),
    uptimeSeconds: z.number(),
    database: z.object({
      reachable: z.boolean(),
      error: z.string().optional(),
    }),
  })
  .openapi('HealthResponse');

const deepHealthResponseSchema = z
  .object({
    overall: z.enum(['up', 'down']),
    timestamp: z.string().datetime(),
    uptimeSeconds: z.number(),
    components: z.object({
      db: z.object({ status: z.enum(['up', 'down']), details: z.string() }),
      soroban: z.object({ status: z.enum(['up', 'down']), details: z.string() }),
      contract: z.object({ status: z.enum(['up', 'down']), details: z.string() }),
    }),
  })
  .openapi('DeepHealthResponse');

const configResponseSchema = z
  .object({
    data: z.object({
      allowedAssets: z.array(assetCodeSchema),
      soroban: z.object({
        enabled: z.boolean(),
        contractId: z.string().optional(),
        networkPassphrase: z.string(),
        rpcUrl: z.string().optional(),
      }),
      sorobanRpcUrl: z.string().optional(),
      contractId: z.string().optional(),
      networkPassphrase: z.string(),
      contractAmountDecimals: z.number().int(),
      walletIntegrationReady: z.boolean(),
      assetAddresses: z.record(z.string(), z.string()),
    }),
  })
  .openapi('ConfigResponse');

const statsResponseSchema = z
  .object({
    data: z.object({
      total_campaigns: z.number().int().openapi({ example: 10 }),
      open_campaigns: z.number().int().openapi({ example: 5 }),
      funded_campaigns: z.number().int().openapi({ example: 3 }),
      failed_campaigns: z.number().int().openapi({ example: 1 }),
      total_pledged_usdc: z.number().openapi({ example: 35000 }),
      total_pledged_xlm: z.number().openapi({ example: 15000 }),
      total_contributors: z.number().int().openapi({ example: 42 }),
      avg_funding_rate_pct: z.number().openapi({ example: 78.5 }),
      totalCampaigns: z.number().int().optional(),
      openCampaigns: z.number().int().optional(),
      fundedCampaigns: z.number().int().optional(),
      claimedCampaigns: z.number().int().optional(),
      failedCampaigns: z.number().int().optional(),
      totalPledgeVolume: z.number().optional(),
      uniqueContributors: z.number().int().optional(),
    }),
  })
  .openapi('StatsResponse');

const leaderboardEntrySchema = z
  .object({
    rank: z.number().int(),
    contributor: stellarAddressSchema,
    totalPledged: z.number(),
    campaignCount: z.number().int(),
    averagePledgeAmount: z.number(),
  })
  .openapi('LeaderboardEntry');

const leaderboardResponseSchema = z
  .object({
    data: z.array(leaderboardEntrySchema),
  })
  .openapi('LeaderboardResponse');

const openIssuesResponseSchema = z
  .object({
    data: z.array(openIssueSchema),
  })
  .openapi('OpenIssuesResponse');

const contributorSummaryResponseSchema = z
  .object({
    data: z.array(contributorSummarySchema),
  })
  .openapi('ContributorSummaryResponse');

const pledgeResponseSchema = z
  .object({
    data: campaignSchema,
  })
  .openapi('PledgeResponse');

const reconcileResponseSchema = z
  .object({
    data: z.object({
      campaign: campaignSchema,
      transactionHash: txHashSchema,
    }),
  })
  .openapi('ReconcileResponse');

const refundResponseSchema = z
  .object({
    data: z.object({
      ...campaignSchema.shape,
      refundedAmount: z.number().openapi({ example: 50 }),
    }),
  })
  .openapi('RefundResponse');

// ---------------------------------------------------------------------------
// Register schemas
// ---------------------------------------------------------------------------

const registeredSchemas = {
  Campaign: registry.register('Campaign', campaignSchema),
  CampaignProgress: registry.register('CampaignProgress', campaignProgressSchema),
  Pledge: registry.register('Pledge', pledgeSchema),
  CampaignEvent: registry.register('CampaignEvent', campaignEventSchema),
  ContributorSummary: registry.register('ContributorSummary', contributorSummarySchema),
  OpenIssue: registry.register('OpenIssue', openIssueSchema),
  ApiError: registry.register('ApiError', apiErrorSchema),
  CreateCampaignPayload: registry.register('CreateCampaignPayload', createCampaignRequestSchema),
  CreatePledgePayload: registry.register('CreatePledgePayload', createPledgeRequestSchema),
  ReconcilePledgePayload: registry.register('ReconcilePledgePayload', reconcilePledgeRequestSchema),
  ClaimCampaignPayload: registry.register('ClaimCampaignPayload', claimCampaignRequestSchema),
  RefundPayload: registry.register('RefundPayload', refundRequestSchema),
  CampaignListResponse: registry.register('CampaignListResponse', campaignListResponseSchema),
  CampaignDetailResponse: registry.register('CampaignDetailResponse', campaignDetailResponseSchema),
  PledgeListResponse: registry.register('PledgeListResponse', pledgeListResponseSchema),
  PledgeResponse: registry.register('PledgeResponse', pledgeResponseSchema),
  ReconcileResponse: registry.register('ReconcileResponse', reconcileResponseSchema),
  RefundResponse: registry.register('RefundResponse', refundResponseSchema),
  ContributorSummaryResponse: registry.register(
    'ContributorSummaryResponse',
    contributorSummaryResponseSchema,
  ),
  CampaignHistoryResponse: registry.register(
    'CampaignHistoryResponse',
    campaignHistoryResponseSchema,
  ),
  HealthResponse: registry.register('HealthResponse', healthResponseSchema),
  DeepHealthResponse: registry.register('DeepHealthResponse', deepHealthResponseSchema),
  ConfigResponse: registry.register('ConfigResponse', configResponseSchema),
  StatsResponse: registry.register('StatsResponse', statsResponseSchema),
  LeaderboardResponse: registry.register('LeaderboardResponse', leaderboardResponseSchema),
  OpenIssuesResponse: registry.register('OpenIssuesResponse', openIssuesResponseSchema),
  CreateApiKeyRequest: registry.register('CreateApiKeyRequest', createApiKeyRequestSchema),
  ApiKeyResponse: registry.register('ApiKeyResponse', apiKeyResponseSchema),
  CreatedApiKeyResponse: registry.register('CreatedApiKeyResponse', createdApiKeyResponseSchema),
  RotateApiKeyRequest: registry.register('RotateApiKeyRequest', rotateApiKeyRequestSchema),
};

// ---------------------------------------------------------------------------
// Register paths
// ---------------------------------------------------------------------------

const notFoundResponse = {
  description: 'Resource not found',
  content: { 'application/json': { schema: registeredSchemas.ApiError } },
};

const validationErrorResponse = {
  description: 'Validation error',
  content: { 'application/json': { schema: registeredSchemas.ApiError } },
};

const payloadTooLargeResponse = {
  description: 'Request body exceeds the 64KB maximum limit',
  content: { 'application/json': { schema: registeredSchemas.ApiError } },
};

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['Health'],
  summary: 'Basic health check',
  security: [],
  responses: {
    200: {
      description: 'Service is healthy',
      content: { 'application/json': { schema: registeredSchemas.HealthResponse } },
    },
    503: {
      description: 'Service is degraded',
      content: { 'application/json': { schema: registeredSchemas.HealthResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/health/deep',
  tags: ['Health'],
  summary: 'Deep health check',
  description: 'Checks database, Soroban RPC, and contract configuration health.',
  security: [],
  responses: {
    200: {
      description: 'All components are healthy',
      content: { 'application/json': { schema: registeredSchemas.DeepHealthResponse } },
    },
    503: {
      description: 'One or more components are unhealthy',
      content: { 'application/json': { schema: registeredSchemas.DeepHealthResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns',
  tags: ['Campaigns'],
  summary: 'List campaigns',
  description: 'List campaigns with optional filtering, sorting, and pagination.',
  request: {
    query: z.object({
      page: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .openapi({ description: 'Page number (requires limit).' }),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .openapi({ description: 'Items per page (requires page).' }),
      q: z.string().optional().openapi({ description: 'Search query (title, creator, or id).' }),
      search: z.string().optional().openapi({ description: 'Alias for q.' }),
      asset: z.string().optional().openapi({ description: 'Comma-separated list of asset codes.' }),
      status: z.enum(['open', 'funded', 'claimed', 'failed']).optional(),
      sort: z.enum(['createdAt', 'deadline', 'pledgedAmount', 'targetAmount']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      includeDeleted: z.enum(['true', 'false']).optional().openapi({
        description: "Include archived (soft-deleted) campaigns. Alias: 'include_archived'.",
      }),
      include_archived: z
        .enum(['true', 'false'])
        .optional()
        .openapi({ description: "Alias for 'includeDeleted'." }),
      createdAfter: z
        .string()
        .datetime()
        .optional()
        .openapi({ description: 'ISO 8601 timestamp.' }),
      createdBefore: z
        .string()
        .datetime()
        .optional()
        .openapi({ description: 'ISO 8601 timestamp.' }),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of campaigns',
      content: { 'application/json': { schema: registeredSchemas.CampaignListResponse } },
    },
    400: validationErrorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns',
  tags: ['Campaigns'],
  summary: 'Create a campaign',
  request: {
    body: {
      content: { 'application/json': { schema: registeredSchemas.CreateCampaignPayload } },
      description: 'Campaign creation payload',
    },
  },
  responses: {
    201: {
      description: 'Campaign created',
      content: { 'application/json': { schema: registeredSchemas.CampaignDetailResponse } },
    },
    400: validationErrorResponse,
    413: payloadTooLargeResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns/{id}',
  tags: ['Campaigns'],
  summary: 'Get campaign details',
  request: { params: z.object({ id: campaignIdParamSchema }) },
  responses: {
    200: {
      description: 'Campaign details',
      content: { 'application/json': { schema: registeredSchemas.CampaignDetailResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/campaigns/{id}',
  tags: ['Campaigns'],
  summary: 'Archive (soft-delete) a campaign',
  description:
    'Sets the archivedAt/deletedAt timestamp on a campaign. Archived campaigns are excluded ' +
    "from the default campaign list but their pledges and history are preserved. Use POST " +
    '/api/campaigns/{id}/restore to un-archive.',
  request: { params: z.object({ id: campaignIdParamSchema }) },
  responses: {
    200: {
      description: 'Campaign archived',
      content: { 'application/json': { schema: registeredSchemas.CampaignDetailResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    409: { description: 'Campaign is already archived' },
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{id}/restore',
  tags: ['Campaigns'],
  summary: 'Restore an archived campaign',
  description: 'Clears the archivedAt/deletedAt timestamp, making the campaign active again.',
  request: { params: z.object({ id: campaignIdParamSchema }) },
  responses: {
    200: {
      description: 'Campaign restored',
      content: { 'application/json': { schema: registeredSchemas.CampaignDetailResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    409: { description: 'Campaign is not archived' },
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns/{id}/pledges',
  tags: ['Pledges'],
  summary: 'List campaign pledges',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of pledges',
      content: { 'application/json': { schema: registeredSchemas.PledgeListResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{id}/pledges',
  tags: ['Pledges'],
  summary: 'Create a pledge',
  description: 'Creates a pledge for a campaign. Use the Idempotency-Key header to make the request idempotent. Cached responses are returned for 24 hours.',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    body: {
      content: { 'application/json': { schema: registeredSchemas.CreatePledgePayload } },
      description: 'Pledge creation payload',
    },
  },
  responses: {
    201: {
      description: 'Pledge recorded',
      content: { 'application/json': { schema: registeredSchemas.PledgeResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    413: payloadTooLargeResponse,
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{id}/pledges/reconcile',
  tags: ['Pledges'],
  summary: 'Reconcile an on-chain pledge',
  description: 'Records a pledge that was already executed on-chain using its transaction hash.',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    body: {
      content: { 'application/json': { schema: registeredSchemas.ReconcilePledgePayload } },
      description: 'Reconciliation payload',
    },
  },
  responses: {
    201: {
      description: 'Pledge reconciled',
      content: { 'application/json': { schema: registeredSchemas.ReconcileResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    413: payloadTooLargeResponse,
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{id}/claim',
  tags: ['Campaigns'],
  summary: 'Claim a campaign',
  description: 'Claims funds for a successfully funded campaign after the deadline.',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    body: {
      content: { 'application/json': { schema: registeredSchemas.ClaimCampaignPayload } },
      description: 'Claim payload',
    },
  },
  responses: {
    200: {
      description: 'Campaign claimed',
      content: { 'application/json': { schema: registeredSchemas.CampaignDetailResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    413: payloadTooLargeResponse,
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/campaigns/{id}/refund',
  tags: ['Pledges'],
  summary: 'Refund a contributor',
  description:
    'Refunds a contributor for a failed campaign after verifying the on-chain transaction.',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    body: {
      content: { 'application/json': { schema: registeredSchemas.RefundPayload } },
      description: 'Refund payload',
    },
  },
  responses: {
    200: {
      description: 'Refund processed',
      content: { 'application/json': { schema: registeredSchemas.RefundResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
    413: payloadTooLargeResponse,
    429: { description: 'Rate limit exceeded' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns/{id}/contributors',
  tags: ['Campaigns'],
  summary: 'Get campaign contributor summary',
  request: { params: z.object({ id: campaignIdParamSchema }) },
  responses: {
    200: {
      description: 'Contributor summary',
      content: { 'application/json': { schema: registeredSchemas.ContributorSummaryResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/campaigns/{id}/history',
  tags: ['Campaigns'],
  summary: 'Get campaign event history',
  request: {
    params: z.object({ id: campaignIdParamSchema }),
    query: z.object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Campaign event history',
      content: { 'application/json': { schema: registeredSchemas.CampaignHistoryResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/open-issues',
  tags: ['Misc'],
  summary: 'List open issues',
  security: [],
  responses: {
    200: {
      description: 'List of open development issues',
      content: { 'application/json': { schema: registeredSchemas.OpenIssuesResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/config',
  tags: ['Misc'],
  summary: 'Get runtime configuration',
  security: [],
  responses: {
    200: {
      description: 'Runtime configuration',
      content: { 'application/json': { schema: registeredSchemas.ConfigResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/stats',
  tags: ['Misc'],
  summary: 'Get global statistics',
  security: [],
  responses: {
    200: {
      description: 'Global campaign and pledge statistics',
      content: { 'application/json': { schema: registeredSchemas.StatsResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/docs',
  tags: ['Docs'],
  summary: 'Open Swagger UI',
  description: 'Development-only interactive documentation for this API.',
  security: [],
  responses: {
    200: {
      description: 'Swagger UI HTML',
      content: { 'text/html': { schema: { type: 'string' } } },
    },
    404: { description: 'Swagger UI is disabled in production' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/openapi.json',
  tags: ['Docs'],
  summary: 'Get the OpenAPI specification',
  description: 'Returns the machine-readable OpenAPI 3.1 specification for this API.',
  security: [],
  responses: {
    200: {
      description: 'OpenAPI JSON spec',
      content: { 'application/json': { schema: z.object({}).passthrough() } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/leaderboard',
  tags: ['Misc'],
  summary: 'Get contributor leaderboard',
  security: [],
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .openapi({ description: 'Number of top contributors to return.', example: 10 }),
    }),
  },
  responses: {
    200: {
      description: 'Leaderboard',
      content: { 'application/json': { schema: registeredSchemas.LeaderboardResponse } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: registeredSchemas.ApiError } },
    },
  },
});

// ---------------------------------------------------------------------------
// API Key Management Routes
// ---------------------------------------------------------------------------

registry.registerPath({
  method: 'post',
  path: '/api/api-keys',
  tags: ['API Keys'],
  summary: 'Create an API key',
  description:
    'Creates a new API key with the specified scope. The plain key is only returned once.',
  security: [],
  request: {
    body: {
      content: { 'application/json': { schema: registeredSchemas.CreateApiKeyRequest } },
      description: 'API key creation payload',
    },
  },
  responses: {
    201: {
      description: 'API key created',
      content: { 'application/json': { schema: registeredSchemas.CreatedApiKeyResponse } },
    },
    400: validationErrorResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/api-keys',
  tags: ['API Keys'],
  summary: 'List API keys',
  description: 'Lists all active (non-revoked) API keys with masked secrets.',
  security: [],
  responses: {
    200: {
      description: 'List of API keys',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(apiKeyResponseSchema),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/api-keys/{id}',
  tags: ['API Keys'],
  summary: 'Revoke an API key',
  description: 'Revokes an API key immediately.',
  security: [],
  request: {
    params: z.object({
      id: z
        .string()
        .openapi({ param: { name: 'id', in: 'path', required: true }, example: 'abc123def456' }),
    }),
  },
  responses: {
    204: { description: 'API key revoked' },
    404: notFoundResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/api-keys/{id}/rotate',
  tags: ['API Keys'],
  summary: 'Rotate an API key',
  description:
    'Creates a new API key to replace the specified key. The old key remains valid during a grace period (default 7 days) before being automatically revoked.',
  security: [],
  request: {
    params: z.object({
      id: z
        .string()
        .openapi({ param: { name: 'id', in: 'path', required: true }, example: 'abc123def456' }),
    }),
    body: {
      content: { 'application/json': { schema: registeredSchemas.RotateApiKeyRequest } },
      description: 'API key rotation payload',
    },
  },
  responses: {
    201: {
      description: 'API key rotated',
      content: { 'application/json': { schema: registeredSchemas.CreatedApiKeyResponse } },
    },
    400: validationErrorResponse,
    404: notFoundResponse,
  },
});

// ---------------------------------------------------------------------------
// Spec generation
// ---------------------------------------------------------------------------

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Stellar Goal Vault API',
      description: 'Machine-readable OpenAPI specification for the Stellar Goal Vault backend.',
      version: '1.0.0',
    },
    servers: [
      { url: `http://localhost:${config.port}`, description: 'Local development server' },
      { url: '/', description: 'Relative server URL' },
    ],
    security: [{ [bearerAuth.name]: [] }],
  });
}

export const openApiPathCount = registry.definitions.filter((d) => d.type === 'route').length;
