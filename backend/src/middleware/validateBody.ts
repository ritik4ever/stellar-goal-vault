import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { AppError } from '../types/errors';
import { zodIssuesToErrorMessage, zodIssuesToValidationIssues } from '../validation/schemas';

/**
 * Returns Express middleware that validates `req.body` against the given
 * Zod schema.  On success, `req.body` is replaced with the parsed (and
 * potentially transformed or stripped) value so downstream handlers see
 * the validated shape.  On failure, the middleware calls `next(AppError)`
 * so that the central error handler in `index.ts` emits a consistent
 * machine-readable response envelope:
 *
 *   { success: false, error: { code, message, requestId, details } }
 *
 * and the `request_error` structured log line with `event`, `requestId`,
 * `method`, `path`, `status`, and `code` fields.
 *
 * Uses `safeParseAsync` so the middleware works with schemas that include
 * async refinements or transforms; plain synchronous schemas resolve in a
 * single microtask with no observable cost.
 *
 * Designed for POST and PATCH routes that accept a JSON payload; URL
 * parameter validation is intentionally out of scope.  Use one of the
 * existing schemas from `src/validation/schemas.ts` (for example
 * `createCampaignPayloadSchema`) or any other Zod schema as the argument.
 */
export function validateBody<TSchema extends ZodType>(schema: TSchema): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const parsed = await schema.safeParseAsync(req.body);
    if (!parsed.success) {
      const zodError = parsed.error as ZodError;
      next(
        new AppError(
          zodIssuesToErrorMessage(zodError.issues),
          400,
          'VALIDATION_ERROR',
          zodIssuesToValidationIssues(zodError.issues),
        ),
      );
      return;
    }

    req.body = parsed.data;
    next();
  };
}
