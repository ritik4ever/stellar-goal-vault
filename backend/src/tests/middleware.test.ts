import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { apiKeyAuthMiddleware, RequestWithApiKey } from "../middleware/apiKeyAuth";
import { cacheMiddleware, invalidateCache } from "../middleware/cacheMiddleware";
import * as cacheService from "../services/cache";

// Mock redis
vi.mock("redis", () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  return {
    createClient: vi.fn(() => mockClient),
  };
});

describe("API Key Auth Middleware", () => {
  let mockReq: Partial<RequestWithApiKey>;
  let mockRes: Partial<Response>;
  let next: NextFunction;
  let originalEnvApiKeys: string | undefined;

  beforeEach(() => {
    originalEnvApiKeys = process.env.API_KEYS;
    mockReq = {
      path: "/api/campaigns",
      headers: {},
    };
    mockRes = {};
    next = vi.fn();
  });

  afterEach(() => {
    process.env.API_KEYS = originalEnvApiKeys;
  });

  it("should bypass authentication for public paths", () => {
    mockReq.path = "/api/health/deep";
    apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    expect(mockReq.isAuthenticated).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it("should throw 401 if Authorization header is missing", () => {
    process.env.API_KEYS = "key1,key2";
    expect(() => {
      apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    }).toThrow(/Missing or invalid Authorization header/);
    expect(next).not.toHaveBeenCalled();
  });

  it("should throw 401 if Authorization header does not start with Bearer", () => {
    process.env.API_KEYS = "key1,key2";
    mockReq.headers = { authorization: "Basic base64" };
    expect(() => {
      apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    }).toThrow(/Missing or invalid Authorization header/);
  });

  it("should allow all requests if no API keys are configured (dev mode)", () => {
    process.env.API_KEYS = "";
    mockReq.headers = { authorization: "Bearer developmentkey" };
    apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    expect(mockReq.isAuthenticated).toBe(true);
    expect(mockReq.apiKey).toBe("developmentkey");
    expect(next).toHaveBeenCalled();
  });

  it("should allow request if valid API key is provided", () => {
    process.env.API_KEYS = "key1,key2";
    mockReq.headers = { authorization: "Bearer key2" };
    apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    expect(mockReq.isAuthenticated).toBe(true);
    expect(mockReq.apiKey).toBe("key2");
    expect(next).toHaveBeenCalled();
  });

  it("should throw 403 if invalid API key is provided", () => {
    process.env.API_KEYS = "key1,key2";
    mockReq.headers = { authorization: "Bearer invalidkey" };
    expect(() => {
      apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, next);
    }).toThrow(/Invalid API key/);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("Cache Middleware", () => {
  let mockReq: any;
  let mockRes: any;
  let next: NextFunction;
  let headers: Record<string, string>;
  let sentData: any;

  beforeEach(() => {
    headers = {};
    sentData = null;
    mockReq = {
      method: "GET",
      path: "/api/campaigns",
      query: { limit: "10", sort: "deadline" },
    };
    mockRes = {
      statusCode: 200,
      setHeader: vi.fn((key, val) => {
        headers[key] = val;
      }),
      send: vi.fn((data) => {
        sentData = data;
        return mockRes;
      }),
    };
    next = vi.fn();
    vi.spyOn(cacheService, "isCacheAvailable").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should bypass caching for non-GET requests", async () => {
    mockReq.method = "POST";
    const middleware = cacheMiddleware();
    await middleware(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it("should bypass caching if cache is not available", async () => {
    vi.spyOn(cacheService, "isCacheAvailable").mockReturnValue(false);
    const middleware = cacheMiddleware();
    await middleware(mockReq, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it("should return cached response on hit", async () => {
    vi.spyOn(cacheService, "getCacheValue").mockResolvedValue('{"data":"cached"}');
    const middleware = cacheMiddleware();
    await middleware(mockReq, mockRes, next);

    expect(headers["X-Cache"]).toBe("HIT");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(sentData).toBe('{"data":"cached"}');
    expect(next).not.toHaveBeenCalled();
  });

  it("should intercept response and set cache on miss", async () => {
    vi.spyOn(cacheService, "getCacheValue").mockResolvedValue(null);
    const setSpy = vi.spyOn(cacheService, "setCacheValue").mockResolvedValue(true);

    const middleware = cacheMiddleware(100);
    await middleware(mockReq, mockRes, next);

    expect(next).toHaveBeenCalled();

    // Call res.send to trigger interceptor
    const responsePayload = { success: true };
    mockRes.send(responsePayload);

    expect(headers["X-Cache"]).toBe("MISS");
    expect(setSpy).toHaveBeenCalledWith(
      "cache:GET:/api/campaigns?limit=10&sort=deadline",
      JSON.stringify(responsePayload),
      100
    );
  });

  it("should not cache if response status is not 2xx", async () => {
    vi.spyOn(cacheService, "getCacheValue").mockResolvedValue(null);
    const setSpy = vi.spyOn(cacheService, "setCacheValue");

    const middleware = cacheMiddleware();
    await middleware(mockReq, mockRes, next);

    mockRes.statusCode = 500;
    mockRes.send("Error");

    expect(headers["X-Cache"]).toBeUndefined();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("should call clearCachePattern on invalidateCache", async () => {
    const clearSpy = vi.spyOn(cacheService, "clearCachePattern").mockResolvedValue(1);
    await invalidateCache("campaigns:*");
    expect(clearSpy).toHaveBeenCalledWith("campaigns:*");
  });

  it("should bypass invalidateCache if cache is not available", async () => {
    vi.spyOn(cacheService, "isCacheAvailable").mockReturnValue(false);
    const clearSpy = vi.spyOn(cacheService, "clearCachePattern");
    await invalidateCache("campaigns:*");
    expect(clearSpy).not.toHaveBeenCalled();
  });
});

describe("Cache Service (cache.ts)", () => {
  let originalEnv: string | undefined;
  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    originalRedisUrl = process.env.REDIS_URL;
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    process.env.REDIS_URL = originalRedisUrl;
    await cacheService.closeRedisCache();
  });

  it("should skip initialization if no REDIS_URL or not production", async () => {
    process.env.NODE_ENV = "test";
    process.env.REDIS_URL = "";
    await cacheService.initRedisCache();
    expect(cacheService.isCacheAvailable()).toBe(false);
  });

  it("should initialize client and check stats if production", async () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://localhost:6379";

    const { createClient } = await import("redis");
    const mockClient = (createClient as any)();

    await cacheService.initRedisCache();

    // Trigger connect callback
    const connectCb = mockClient.on.mock.calls.find((call: any) => call[0] === "connect")[1];
    connectCb();

    expect(cacheService.isCacheAvailable()).toBe(true);

    const stats = await cacheService.getCacheStats();
    expect(stats).toEqual({ available: true, connected: true });
  });

  it("should handle redis error callbacks gracefully", async () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://localhost:6379";

    const { createClient } = await import("redis");
    const mockClient = (createClient as any)();

    await cacheService.initRedisCache();

    const errorCb = mockClient.on.mock.calls.find((call: any) => call[0] === "error")[1];
    errorCb(new Error("redis broken"));

    expect(cacheService.isCacheAvailable()).toBe(false);
  });

  it("should return null for getCacheValue when disconnected", async () => {
    const val = await cacheService.getCacheValue("key");
    expect(val).toBeNull();
  });

  it("should return false for setCacheValue when disconnected", async () => {
    const ok = await cacheService.setCacheValue("key", "val");
    expect(ok).toBe(false);
  });
});
