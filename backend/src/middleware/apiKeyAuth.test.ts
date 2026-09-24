import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { apiKeyAuthMiddleware, RequestWithApiKey } from './apiKeyAuth';
import { AppError } from '../types/errors';

describe('apiKeyAuthMiddleware', () => {
  let mockReq: Partial<RequestWithApiKey>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      method: 'GET',
      path: '/api/campaigns',
      headers: {},
    };
    mockRes = {};
    mockNext = vi.fn();
  });

  describe('Public endpoints', () => {
    const publicPaths = [
      '/api/health',
      '/api/config',
      '/api/stats',
      '/api/leaderboard',
      '/api/open-issues',
    ];

    it.each(publicPaths)('allows access to public path %s without authentication', (path) => {
      mockReq.path = path;
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
    });

    it('allows access to public path subpaths without authentication', () => {
      mockReq.path = '/api/health/deep';
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Production environment', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEYS', 'valid-key-1,valid-key-2');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('requires authentication for write methods (POST)', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('requires authentication for write methods (PUT)', () => {
      mockReq.method = 'PUT';
      mockReq.path = '/api/campaigns/123';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('requires authentication for write methods (PATCH)', () => {
      mockReq.method = 'PATCH';
      mockReq.path = '/api/campaigns/123';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('requires authentication for write methods (DELETE)', () => {
      mockReq.method = 'DELETE';
      mockReq.path = '/api/campaigns/123';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('accepts valid API key for write methods', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      mockReq.headers = { authorization: 'Bearer valid-key-1' };
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
      expect(mockReq.apiKey).toBe('valid-key-1');
    });

    it('rejects invalid API key for write methods', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      mockReq.headers = { authorization: 'Bearer invalid-key' };
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
        })
      );
    });

    it('requires authentication for read methods on non-public paths', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/campaigns/123';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 401,
          code: 'UNAUTHORIZED',
        })
      );
    });

    it('accepts valid API key for read methods on non-public paths', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/campaigns/123';
      mockReq.headers = { authorization: 'Bearer valid-key-2' };
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
    });
  });

  describe('Development environment', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('allows write methods without authentication', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
    });

    it('validates API key if provided in development', () => {
      vi.stubEnv('API_KEYS', 'dev-key-1');
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      mockReq.headers = { authorization: 'Bearer invalid-key' };
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).toThrow(
        expect.objectContaining({
          statusCode: 403,
          code: 'FORBIDDEN',
        })
      );
    });

    it('accepts valid API key if provided in development', () => {
      vi.stubEnv('API_KEYS', 'dev-key-1');
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      mockReq.headers = { authorization: 'Bearer dev-key-1' };
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
      expect(mockReq.apiKey).toBe('dev-key-1');
    });

    it('allows requests without API key when none are configured in development', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
    });
  });

  describe('Test environment', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'test');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('allows write methods without authentication', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      
      expect(() => apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext)).not.toThrow();
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.isAuthenticated).toBe(true);
    });
  });

  describe('Error messages', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEYS', 'valid-key');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('provides helpful error message for missing auth header on write routes', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      
      try {
        apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toContain('Write routes require authentication');
      }
    });

    it('provides helpful error message for invalid API key', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/campaigns';
      mockReq.headers = { authorization: 'Bearer invalid' };
      
      try {
        apiKeyAuthMiddleware(mockReq as RequestWithApiKey, mockRes as Response, mockNext);
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).message).toBe('Invalid API key');
      }
    });
  });
});