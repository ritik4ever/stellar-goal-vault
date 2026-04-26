import { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestLog, logRequest } from "./logger";

type RequestWithId = Request & { requestId?: string };

const originalNodeEnv = process.env.NODE_ENV;

function buildRequest(overrides: Partial<RequestWithId> = {}): RequestWithId {
  const defaultRequest = {
    method: "GET",
    path: "/api/health",
    originalUrl: "/api/health?token=secret",
    url: "/api/health?token=secret",
    requestId: "req-123",
    headers: {
      "x-forwarded-for": "192.168.1.1, 10.0.0.1",
      "user-agent": "vitest-agent",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
    get: (key: string) => {
      if (key.toLowerCase() === "user-agent") {
        return "vitest-agent";
      }
      return undefined;
    },
  } as unknown as RequestWithId;

  return {
    ...defaultRequest,
    ...overrides,
  } as RequestWithId;
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.restoreAllMocks();
});

describe("logger service", () => {
  it("creates structured log fields from request data", () => {
    const request = buildRequest();

    const log = createRequestLog(request, 201, 12.3456);

    expect(log.method).toBe("GET");
    expect(log.path).toBe("/api/health");
    expect(log.statusCode).toBe(201);
    expect(log.duration).toBe("12.35ms");
    expect(log.durationMs).toBe(12.35);
    expect(log.requestId).toBe("req-123");
    expect(log.userAgent).toBe("vitest-agent");
    expect(log.remoteIp).toBe("192.168.1.1");
    expect(log.timestamp).toBeDefined();
  });

  it("falls back to socket remote address when x-forwarded-for is missing", () => {
    const request = buildRequest({
      headers: {
        "user-agent": "vitest-agent",
      },
    } as unknown as Partial<RequestWithId>);

    const log = createRequestLog(request, 200, 5);

    expect(log.remoteIp).toBe("127.0.0.1");
  });

  it("writes readable text logs in development", () => {
    process.env.NODE_ENV = "development";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      return;
    });

    logRequest({
      timestamp: "2026-03-27T21:00:00.000Z",
      method: "POST",
      path: "/api/campaigns",
      statusCode: 201,
      durationMs: 30,
      duration: "30.00ms",
      requestId: "req-abc",
      remoteIp: "127.0.0.1",
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const message = String(consoleSpy.mock.calls[0]?.[0]);
    expect(message).toContain("POST");
    expect(message).toContain("/api/campaigns");
    expect(message).toContain("status=201");
    expect(message).toContain("duration=30.00ms");
    expect(message).toContain("requestId=req-abc");
  });

  it("writes JSON logs in production", () => {
    process.env.NODE_ENV = "production";
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      return;
    });

    logRequest({
      timestamp: "2026-03-27T21:00:00.000Z",
      method: "GET",
      path: "/api/health",
      statusCode: 500,
      durationMs: 3.5,
      duration: "3.50ms",
      requestId: "req-fail",
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const rawPayload = String(consoleSpy.mock.calls[0]?.[0]);
    const payload = JSON.parse(rawPayload) as {
      level: string;
      method: string;
      statusCode: number;
    };

    expect(payload.level).toBe("error");
    expect(payload.method).toBe("GET");
    expect(payload.statusCode).toBe(500);
  });
});
