import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../types/errors';
import { validateBody } from './validateBody';

const schema = z
  .object({
    name: z.string(),
    age: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Minimal error handler that mirrors the production central error handler in
 * index.ts.  validateBody now calls next(AppError) so the test app needs an
 * error handler to turn that into a response.
 */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' } });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/echo', validateBody(schema), (req, res) => {
    res.json({ data: req.body });
  });
  // Central error handler must be last
  app.use(errorHandler);
  return app;
}

describe('validateBody', () => {
  it('passes through and exposes parsed.data when the payload is valid', async () => {
    const response = await request(buildApp()).post('/echo').send({ name: 'goal', age: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { name: 'goal', age: 1 } });
  });

  it('replaces req.body with parsed.data so coercion and stripping are visible to downstream handlers', async () => {
    // Schema coerces a string into a number and transforms the name to upper
    // case. The downstream handler reads req.body, so if the middleware
    // stopped assigning req.body = parsed.data the response would echo back
    // the raw input instead of the parsed form.
    const coercingSchema = z.object({
      name: z.string().transform((value) => value.toUpperCase()),
      age: z.coerce.number().int(),
    });

    const app = express();
    app.use(express.json());
    app.post('/coerce', validateBody(coercingSchema), (req, res) => {
      res.json({ data: req.body });
    });
    app.use(errorHandler);

    const response = await request(app).post('/coerce').send({ name: 'goal', age: '7' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { name: 'GOAL', age: 7 } });
  });

  it('returns 400 with the structured error envelope when a required field is missing', async () => {
    const response = await request(buildApp()).post('/echo').send({ age: 1 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof response.body.error.message).toBe('string');
    // details are ValidationIssue[] = { field: string, message: string }
    expect(Array.isArray(response.body.error.details)).toBe(true);
    expect(response.body.error.details).toHaveLength(1);
    expect(response.body.error.details[0].field).toBe('name');
    expect(typeof response.body.error.details[0].message).toBe('string');
  });

  it('returns 400 with the structured error envelope when a field has the wrong type', async () => {
    const response = await request(buildApp()).post('/echo').send({ name: 'goal', age: 'one' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toHaveLength(1);
    expect(response.body.error.details[0].field).toBe('age');
    expect(typeof response.body.error.details[0].message).toBe('string');
  });

  it('returns 400 with the structured error envelope when an extra field is present on a strict schema', async () => {
    const response = await request(buildApp())
      .post('/echo')
      .send({ name: 'goal', age: 1, surprise: true });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThanOrEqual(1);
    // field name is the joined path; for unrecognized_keys the field is 'body'
    const issue = response.body.error.details[0];
    expect(typeof issue.field).toBe('string');
    expect(typeof issue.message).toBe('string');
  });
});
