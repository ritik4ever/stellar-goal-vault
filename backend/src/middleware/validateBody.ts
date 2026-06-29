import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodIssue, ZodType } from 'zod';

/**
 * Shape of a 400 response emitted by the validation middleware. The
 * `details` array is the raw `ZodIssue[]` so callers see the exact path,
 * code, and message for every offending field without the middleware
 * needing to map them into a project-specific shape.
 */
export interface ValidationErrorResponse {
  error: 'Validation failed';
  details: ZodIssue[];
}

/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema. On success, `req.body` is replaced with the parsed (and
 * potentially transformed or stripped) value so downstream handlers see
 * the validated shape. On failure, the middleware short-circuits with a
 * 400 response of the form `{ error: 'Validation failed', details: [...] }`.
 *
 * Designed for POST and PATCH routes that accept a JSON payload; URL
 * parameter validation is intentionally out of scope. Use one of the
 * existing schemas from `src/validation/schemas.ts` (for example
 * `createCampaignPayloadSchema`) or any other Zod schema as the argument.
 */
export function validateBody<TSchema extends ZodType>(schema: TSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const body: ValidationErrorResponse = {
        error: 'Validation failed',
        details: (parsed.error as ZodError).issues,
      };
      res.status(400).json(body);
      return;
    }

    req.body = parsed.data;
    next();
  };
}
