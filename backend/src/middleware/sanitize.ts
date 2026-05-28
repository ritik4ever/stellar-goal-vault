import { Request, Response, NextFunction } from "express";
import he from "he";

/**
 * Recursively HTML-encodes all string values in an object.
 */
function htmlEncodeStrings(obj: unknown): unknown {
  if (typeof obj === "string") {
    return he.encode(obj, { useNamedReferences: true });
  }
  if (Array.isArray(obj)) {
    return obj.map(htmlEncodeStrings);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = htmlEncodeStrings(value);
    }
    return result;
  }
  return obj;
}

/**
 * Middleware that HTML-encodes all string fields in response bodies
 * to prevent stored XSS when data is rendered in the frontend.
 */
export function sanitizeOutput(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    return originalJson(htmlEncodeStrings(body));
  };
  next();
}
