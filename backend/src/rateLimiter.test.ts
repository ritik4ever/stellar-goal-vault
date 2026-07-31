import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyRateLimit } from "./index";
import { Request, Response } from "express";

describe("Rate Limiter Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let headers: Record<string, string>;

  beforeEach(() => {
    headers = {};
    mockReq = {
      ip: "127.0.0.1",
      method: "GET",
    };
    mockRes = {
      setHeader: vi.fn((key: string, value: string) => {
        headers[key] = value;
        return mockRes as Response;
      }),
    };
  });

  it("should set X-RateLimit headers for GET requests (Read limits)", () => {
    const middleware = applyRateLimit();
    const next = () => {};
    middleware(mockReq as Request, mockRes as Response, next);

    expect(headers["X-RateLimit-Limit"]).toBe("120");
    expect(headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(headers["X-RateLimit-Reset"]).toBeDefined();
  });

  it("should set X-RateLimit headers for POST requests (Write limits)", () => {
    mockReq.method = "POST";
    const middleware = applyRateLimit();
    const next = () => {};
    middleware(mockReq as Request, mockRes as Response, next);

    expect(headers["X-RateLimit-Limit"]).toBe("20");
  });

  it("should enforce rate limiting and throw 429 when limit is exceeded", () => {
    const middleware = applyRateLimit(2);

    // Use unique IPs to avoid collision with other tests' shared rateLimitBuckets
    const makeReq = (ip: string) => ({
      ip,
      method: "POST" as const,
    });

    // First request
    middleware(makeReq("10.0.0.100") as Request, mockRes as Response, () => {});

    // Second request
    middleware(makeReq("10.0.0.100") as Request, mockRes as Response, () => {});

    // Third request - should exceed limit
    expect(() => {
      middleware(makeReq("10.0.0.100") as Request, mockRes as Response, () => {});
    }).toThrow(/Rate limit exceeded/);
    expect(headers["Retry-After"]).toBeDefined();
  });
});
