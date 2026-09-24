import { describe, expect, it, beforeEach, vi } from 'vitest';
import { apiKeyAuthMiddleware, RequestWithApiKey } from './apiKeyAuth';
import { AppError } from '../types/errors';
import { clearAbuseControlCaches } from '../services/abuseControl';
import { Request, Response } from 'express';

describe('API Key Authentication Middleware with Abuse Controls', () => {
  let mockReq: Partial<RequestWithApiKey>;
  let mockRes: Partial<Response>;
  let nextCalled: boolean;
  let nextError: Error | null;

  beforeEach(() => {
    clearAbuseControlCaches();
    vi.resetModules();
    vi.unstubAllEnvs();
    
    nextCalled = false;
    nextError = null;
    
    mockReq = {
      ip: '192.168.1.1',
      path: '/api/campaigns',
      headers: {},
    };
    
    mockRes = {};
    
    const next = (err?: Error) => {
      nextCalled = true;
      if (err) nextError = err;
    };
    
    (mockReq as any).next = next;
  });

  const createMiddleware = () => {
    return (req: RequestWithApiKey, res: Response, next: (err?: Error) => void) => {
      try {
        apiKeyAuthMiddleware(req, res, next);
      } catch (error) {
        next(error as Error);
      }
    };
  };

  describe('public endpoints', () => {
    it('should allow public endpoints without authentication', () => {
      mockReq.path = '/api/health';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
      expect(mockReq.isAuthenticated).toBe(true);
    });

    it('should allow /api/config without authentication', () => {
      mockReq.path = '/api/config';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
    });

    it('should allow /api/stats without authentication', () => {
      mockReq.path = '/api/stats';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
    });
  });

  describe('development mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEYS', '');
    });

    it('should allow requests without API keys in development', () => {
      mockReq.headers.authorization = 'Bearer any-key';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
      expect(mockReq.isAuthenticated).toBe(true);
    });

    it('should not apply abuse controls in development', () => {
      mockReq.headers.authorization = 'Bearer invalid-key';
      const middleware = createMiddleware();
      
      // Make many failed attempts - should not be limited in development
      for (let i = 0; i < 20; i++) {
        nextCalled = false;
        nextError = null;
        middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
        
        // Should continue to allow requests (development mode)
        expect(nextCalled).toBe(true);
      }
    });
  });

  describe('production mode with API keys configured', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEYS', 'valid-key-1,valid-key-2');
    });

    it('should reject requests without authorization header', () => {
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).statusCode).toBe(401);
      expect((nextError as AppError).code).toBe('UNAUTHORIZED');
    });

    it('should reject requests with invalid authorization format', () => {
      mockReq.headers.authorization = 'InvalidFormat';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).statusCode).toBe(401);
    });

    it('should reject requests with invalid API key', () => {
      mockReq.headers.authorization = 'Bearer invalid-key';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).statusCode).toBe(403);
      expect((nextError as AppError).code).toBe('FORBIDDEN');
    });

    it('should accept requests with valid API key', () => {
      mockReq.headers.authorization = 'Bearer valid-key-1';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
      expect(mockReq.isAuthenticated).toBe(true);
      expect(mockReq.apiKey).toBe('valid-key-1');
    });

    it('should apply abuse control after 10 failed attempts', () => {
      mockReq.headers.authorization = 'Bearer invalid-key';
      const middleware = createMiddleware();
      
      // First 9 attempts should get FORBIDDEN
      for (let i = 0; i < 9; i++) {
        nextCalled = false;
        nextError = null;
        middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
        
        expect(nextCalled).toBe(true);
        expect(nextError).toBeInstanceOf(AppError);
        expect((nextError as AppError).statusCode).toBe(403);
      }
      
      // 10th attempt should trigger rate limit
      nextCalled = false;
      nextError = null;
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).statusCode).toBe(429);
      expect((nextError as AppError).code).toBe('TOO_MANY_FAILED_ATTEMPTS');
    });

    it('should apply per-API-key rate limiting', () => {
      mockReq.headers.authorization = 'Bearer valid-key-1';
      const middleware = createMiddleware();
      
      // Make 999 requests - should be allowed
      for (let i = 0; i < 999; i++) {
        nextCalled = false;
        nextError = null;
        middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
        
        expect(nextCalled).toBe(true);
        expect(nextError).toBeNull();
      }
      
      // 1000th request should trigger per-key rate limit
      nextCalled = false;
      nextError = null;
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).statusCode).toBe(429);
      expect((nextError as AppError).code).toBe('API_KEY_RATE_LIMITED');
    });

    it('should track failed attempts separately by IP', () => {
      mockReq.headers.authorization = 'Bearer invalid-key';
      const middleware = createMiddleware();
      
      // First IP makes 10 failed attempts
      mockReq.ip = '192.168.1.1';
      for (let i = 0; i < 10; i++) {
        nextCalled = false;
        nextError = null;
        middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      }
      
      // First IP should be rate limited
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).code).toBe('TOO_MANY_FAILED_ATTEMPTS');
      
      // Second IP should not be limited yet
      mockReq.ip = '192.168.1.2';
      nextCalled = false;
      nextError = null;
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeInstanceOf(AppError);
      expect((nextError as AppError).code).toBe('FORBIDDEN'); // Not rate limited yet
    });
  });

  describe('production mode without API keys configured', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEYS', '');
    });

    it('should allow all requests when no API keys are configured', () => {
      mockReq.headers.authorization = 'Bearer any-key';
      const middleware = createMiddleware();
      
      middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
      
      expect(nextCalled).toBe(true);
      expect(nextError).toBeNull();
      expect(mockReq.isAuthenticated).toBe(true);
    });

    it('should not apply abuse controls when no API keys are configured', () => {
      mockReq.headers.authorization = 'Bearer invalid-key';
      const middleware = createMiddleware();
      
      // Make many attempts - should not be limited when no API keys configured
      for (let i = 0; i < 20; i++) {
        nextCalled = false;
        nextError = null;
        middleware(mockReq as RequestWithApiKey, mockRes as Response, (mockReq as any).next);
        
        expect(nextCalled).toBe(true);
        expect(nextError).toBeNull();
      }
    });
  });
});
