import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { initCampaignStore } from '../src/services/campaignStore';

const TEST_DB_PATH = path.join('/tmp', `stellar-goal-vault-schemathesis-${process.pid}.db`);
process.env.DB_PATH = TEST_DB_PATH;
process.env.CONTRACT_ID = 'mock-contract';
process.env.NODE_ENV = 'test';

const SKIPPED_ENDPOINTS = new Set([
  'POST /api/campaigns/{id}/refund',
  'POST /api/campaigns/{id}/pledges/reconcile',
]);

let baseUrl: string;

beforeAll(async () => {
  fs.rmSync(TEST_DB_PATH, { force: true });
  initCampaignStore();
  await new Promise<void>((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as { port: number };
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  fs.rmSync(TEST_DB_PATH, { force: true });
});

describe('API contract: OpenAPI spec validates', () => {
  it('GET /api/docs returns a valid OpenAPI 3.1 spec', async () => {
    const res = await fetch(`${baseUrl}/api/docs`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('Stellar Goal Vault API');
    expect(spec.paths).toBeDefined();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });
});

describe('API contract: each documented endpoint returns a documented status', () => {
  it('all documented endpoints respond with an allowed status code', async () => {
    const specRes = await fetch(`${baseUrl}/api/docs`);
    const spec = await specRes.json();

    for (const [pathPattern, pathDef] of Object.entries(spec.paths)) {
      for (const [method, methodDef] of Object.entries(pathDef)) {
        const key = `${method.toUpperCase()} ${pathPattern}`;
        if (SKIPPED_ENDPOINTS.has(key)) continue;

        let url = pathPattern;

        for (const param of (methodDef.parameters || [])) {
          const schema = param.schema || {};
          let val = '1';
          if (schema.type === 'string') val = 'test';
          if (param.name === 'id') val = '1';
          url = url.replace(`{${param.name}}`, val);
        }

        const qs = new URLSearchParams(
          (methodDef.parameters || [])
            .filter(p => p.in === 'query')
            .map(p => [p.name, '1'])
        ).toString();
        if (qs) url += `?${qs}`;

        let body: unknown;
        if (methodDef.requestBody?.content?.['application/json']?.schema) {
          if (method === 'post' || method === 'put') {
            body = {};
          }
        }

        const res = await fetch(`${baseUrl}${url}`, {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });

        const allowedStatuses = Object.keys(methodDef.responses).map(Number);
        expect(allowedStatuses).toContain(res.status);
      }
    }
  });
});

describe('API contract: GET /api/health returns documented shape', () => {
  it('response contains expected health fields', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(body).toHaveProperty('service', 'stellar-goal-vault-backend');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('uptimeSeconds');
    expect(body).toHaveProperty('database');
    expect(body.database).toHaveProperty('reachable');
  });
});

describe('API contract: GET /api/campaigns returns documented shape', () => {
  it('response contains data and pagination', async () => {
    const res = await fetch(`${baseUrl}/api/campaigns`);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(body.pagination).toHaveProperty('total');
    expect(body.pagination).toHaveProperty('page');
    expect(body.pagination).toHaveProperty('limit');
    expect(body.pagination).toHaveProperty('totalPages');
  });
});

describe('API contract: POST /api/campaigns creates a valid campaign', () => {
  it('campaign response has expected fields', async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const res = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator: `G${'A'.repeat(55)}`,
        title: 'Contract Test Campaign',
        description: 'Campaign created during schemathesis contract validation',
        acceptedTokens: ['USDC'],
        targetAmount: 1000,
        deadline,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('creator');
    expect(body.data).toHaveProperty('title');
    expect(body.data).toHaveProperty('targetAmount');
    expect(body.data).toHaveProperty('deadline');
    expect(body.data.progress).toHaveProperty('status');
    expect(body.data.progress).toHaveProperty('percentFunded');
  });
});

describe('API contract: POST /api/campaigns with invalid data returns 400', () => {
  it('invalid body returns validation error', async () => {
    const res = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    // error response might be success: false format
expect(body.success === false || body.error).toBeTruthy();
    expect(body.success === false || body.error?.code === 'VALIDATION_ERROR').toBe(true);
  });
});

describe('API contract: GET /api/campaigns/invalid-id returns 400', () => {
  it('non-numeric campaign id returns validation error', async () => {
    const res = await fetch(`${baseUrl}/api/campaigns/invalid`);
    expect(res.status).toBe(400);
  });
});

describe('API contract: GET /api/campaigns/9999 returns 404', () => {
  it('non-existent campaign returns not found', async () => {
    const res = await fetch(`${baseUrl}/api/campaigns/9999`);
    expect(res.status).toBe(404);
  });
});

describe('API contract: GET /api/config returns documented shape', () => {
  it('response contains data with allowedAssets', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('allowedAssets');
    expect(body.data).toHaveProperty('soroban');
  });
});

describe('API contract: GET /api/stats returns documented shape', () => {
  it('response contains aggregate metrics', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('totalCampaigns');
    expect(body.data).toHaveProperty('openCampaigns');
    expect(body.data).toHaveProperty('totalPledgeVolume');
    expect(body.data).toHaveProperty('uniqueContributors');
  });
});

describe('API contract: POST /api/campaigns/{id}/pledges creates a pledge', () => {
  it('creates campaign then pledges to it', async () => {
    const deadline = Math.floor(Date.now() / 1000) + 86400;
    const createRes = await fetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator: `G${'A'.repeat(55)}`,
        title: 'Pledge Contract Test',
        description: 'Campaign for testing pledge endpoint contract',
        acceptedTokens: ['USDC'],
        targetAmount: 1000,
        deadline,
      }),
    });
    expect(createRes.status).toBe(201);
    const campaign = await createRes.json();
    const campaignId = campaign.data.id;

    const pledgeRes = await fetch(`${baseUrl}/api/campaigns/${campaignId}/pledges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contributor: `G${'B'.repeat(55)}`,
        amount: 100,
        assetCode: 'USDC',
      }),
    });
    expect(pledgeRes.status).toBe(201);
    const pledgeBody = await pledgeRes.json();
    expect(pledgeBody.data.progress.pledgeCount).toBeGreaterThan(0);
  });
});

describe('API contract: GET /api/open-issues returns documented shape', () => {
  it('response contains data array', async () => {
    const res = await fetch(`${baseUrl}/api/open-issues`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });
});