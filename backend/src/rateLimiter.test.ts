import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyRateLimit } from "./index";
import { Request, Response } from "express";

describe("Rate Limiter Middleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextCalled: boolean;
  let headers: Record<string, string>;

  beforeEach(() => {
    nextCalled = false;
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

  const next = () => {
    nextCalled = true;
  };

  it("should set X-RateLimit headers for GET requests (Read limits)", () => {
    const middleware = applyRateLimit();
    middleware(mockReq as Request, mockRes as Response, next);

    expect(nextCalled).toBe(true);
    expect(headers["X-RateLimit-Limit"]).toBe("120");
    expect(headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(headers["X-RateLimit-Reset"]).toBeDefined();
  });

  it("should set X-RateLimit headers for POST requests (Write limits)", () => {
    mockReq.method = "POST";
    const middleware = applyRateLimit();
    middleware(mockReq as Request, mockRes as Response, next);

    expect(nextCalled).toBe(true);
    expect(headers["X-RateLimit-Limit"]).toBe("20");
  });

  it("should enforce rate limiting and throw 429 when limit is exceeded", () => {
    mockReq.method = "POST";
    const middleware = applyRateLimit(2); // Set limit to 2 for testing

    // First request
    middleware(mockReq as Request, mockRes as Response, next);
    expect(nextCalled).toBe(true);

    // Second request
    nextCalled = false;
    middleware(mockReq as Request, mockRes as Response, next);
    expect(nextCalled).toBe(true);

    // Third request - should exceed limit
    nextCalled = false;
    expect(() => {
      middleware(mockReq as Request, mockRes as Response, next);
    }).toThrow(/Rate limit exceeded/);
    expect(headers["Retry-After"]).toBeDefined();
  });
});
