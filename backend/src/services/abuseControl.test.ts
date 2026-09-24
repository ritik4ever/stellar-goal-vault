import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  recordFailedApiKeyAttempt,
  recordApiKeyUsage,
  clearAbuseControlCaches,
  getAbuseControlStats,
} from './abuseControl';

describe('Abuse Control Service', () => {
  beforeEach(() => {
    clearAbuseControlCaches();
    vi.resetModules();
  });

  describe('recordFailedApiKeyAttempt', () => {
    it('should not limit in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development');
      
      // Simulate many failed attempts
      for (let i = 0; i < 20; i++) {
        expect(recordFailedApiKeyAttempt('127.0.0.1')).toBe(false);
      }
    });

    it('should not limit in test mode', () => {
      vi.stubEnv('NODE_ENV', 'test');
      
      // Simulate many failed attempts
      for (let i = 0; i < 20; i++) {
        expect(recordFailedApiKeyAttempt('127.0.0.1')).toBe(false);
      }
    });

    it('should limit failed attempts in production mode', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // First 9 attempts should not trigger limit
      for (let i = 0; i < 9; i++) {
        expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(false);
      }
      
      // 10th attempt should trigger limit
      expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(true);
      
      // 11th attempt should still be limited
      expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(true);
    });

    it('should track attempts separately by IP', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // First IP should get limited after 10 attempts
      for (let i = 0; i < 10; i++) {
        expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(i === 9);
      }
      
      // Second IP should not be limited yet
      expect(recordFailedApiKeyAttempt('192.168.1.2')).toBe(false);
    });

    it('should handle empty IP gracefully', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      expect(recordFailedApiKeyAttempt('')).toBe(false);
      expect(recordFailedApiKeyAttempt('')).toBe(false);
    });

    it('should reset after window expires', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // Make 10 attempts to trigger limit
      for (let i = 0; i < 10; i++) {
        recordFailedApiKeyAttempt('192.168.1.1');
      }
      expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(true);
      
      // Clear cache to simulate window expiration
      clearAbuseControlCaches();
      
      // Should not be limited after reset
      expect(recordFailedApiKeyAttempt('192.168.1.1')).toBe(false);
    });
  });

  describe('recordApiKeyUsage', () => {
    it('should not limit in development mode', () => {
      vi.stubEnv('NODE_ENV', 'development');
      
      // Simulate many requests with same API key
      for (let i = 0; i < 2000; i++) {
        expect(recordApiKeyUsage('test-api-key')).toBe(false);
      }
    });

    it('should not limit in test mode', () => {
      vi.stubEnv('NODE_ENV', 'test');
      
      // Simulate many requests with same API key
      for (let i = 0; i < 2000; i++) {
        expect(recordApiKeyUsage('test-api-key')).toBe(false);
      }
    });

    it('should limit per-API-key usage in production mode', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // First 999 requests should not trigger limit
      for (let i = 0; i < 999; i++) {
        expect(recordApiKeyUsage('api-key-1')).toBe(false);
      }
      
      // 1000th request should trigger limit
      expect(recordApiKeyUsage('api-key-1')).toBe(true);
      
      // 1001st request should still be limited
      expect(recordApiKeyUsage('api-key-1')).toBe(true);
    });

    it('should track usage separately by API key', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // First API key should get limited after 1000 requests
      for (let i = 0; i < 1000; i++) {
        expect(recordApiKeyUsage('api-key-1')).toBe(i === 999);
      }
      
      // Second API key should not be limited yet
      expect(recordApiKeyUsage('api-key-2')).toBe(false);
    });

    it('should handle empty API key gracefully', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      expect(recordApiKeyUsage('')).toBe(false);
      expect(recordApiKeyUsage('')).toBe(false);
    });
  });

  describe('clearAbuseControlCaches', () => {
    it('should clear all caches', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      // Populate caches
      for (let i = 0; i < 5; i++) {
        recordFailedApiKeyAttempt('192.168.1.1');
        recordApiKeyUsage('api-key-1');
      }
      
      const statsBefore = getAbuseControlStats();
      expect(statsBefore.failedApiKeyAttempts).toBeGreaterThan(0);
      expect(statsBefore.apiKeyUsage).toBeGreaterThan(0);
      
      clearAbuseControlCaches();
      
      const statsAfter = getAbuseControlStats();
      expect(statsAfter.failedApiKeyAttempts).toBe(0);
      expect(statsAfter.apiKeyUsage).toBe(0);
    });
  });

  describe('getAbuseControlStats', () => {
    it('should return current cache sizes', () => {
      vi.stubEnv('NODE_ENV', 'production');
      
      const initialStats = getAbuseControlStats();
      expect(initialStats.failedApiKeyAttempts).toBe(0);
      expect(initialStats.apiKeyUsage).toBe(0);
      
      // Add some entries
      recordFailedApiKeyAttempt('192.168.1.1');
      recordApiKeyUsage('api-key-1');
      
      const updatedStats = getAbuseControlStats();
      expect(updatedStats.failedApiKeyAttempts).toBe(1);
      expect(updatedStats.apiKeyUsage).toBe(1);
    });
  });
});
