import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateBody } from './validateBody';

const schema = z
  .object({
    name: z.string(),
    age: z.number().int().nonnegative(),
  })
  .strict();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/echo', validateBody(schema), (req, res) => {
    res.json({ data: req.body });
  });
  return app;
}

describe('validateBody', () => {
  it('passes through and exposes parsed.data when the payload is valid', async () => {
    const response = await request(buildApp()).post('/echo').send({ name: 'goal', age: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { name: 'goal', age: 1 } });
  });

  it('returns 400 with the Validation failed shape when a required field is missing', async () => {
    const response = await request(buildApp()).post('/echo').send({ age: 1 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(Array.isArray(response.body.details)).toBe(true);
    expect(response.body.details).toHaveLength(1);
    expect(response.body.details[0].path).toEqual(['name']);
  });

  it('returns 400 with the Validation failed shape when a field has the wrong type', async () => {
    const response = await request(buildApp())
      .post('/echo')
      .send({ name: 'goal', age: 'one' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details).toHaveLength(1);
    expect(response.body.details[0].path).toEqual(['age']);
    expect(response.body.details[0].code).toBe('invalid_type');
  });

  it('returns 400 with the Validation failed shape when an extra field is present on a strict schema', async () => {
    const response = await request(buildApp())
      .post('/echo')
      .send({ name: 'goal', age: 1, surprise: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation failed');
    expect(response.body.details.length).toBeGreaterThanOrEqual(1);
    const unrecognized = response.body.details.find(
      (issue: { code: string }) => issue.code === 'unrecognized_keys',
    );
    expect(unrecognized).toBeDefined();
  });
});
