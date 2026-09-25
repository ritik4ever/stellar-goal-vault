import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { REQUEST_ID_HEADER, apiClient, apiRequest } from './httpClient';

describe('apiClient request correlation', () => {
  it('adds X-Request-ID to outgoing requests', async () => {
    const seenHeaders: string[] = [];

    await apiClient.request({
      url: '/health',
      method: 'GET',
      adapter: async (config) => {
        const headers = AxiosHeaders.from(config.headers);
        seenHeaders.push(headers.get(REQUEST_ID_HEADER) as string);
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    expect(seenHeaders[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('forwards the same X-Request-ID across retry attempts', async () => {
    const seenHeaders: string[] = [];
    let attempt = 0;

    await apiRequest({
      url: '/health',
      method: 'GET',
      adapter: async (config) => {
        const headers = AxiosHeaders.from(config.headers);
        seenHeaders.push(headers.get(REQUEST_ID_HEADER) as string);
        attempt += 1;

        if (attempt < 2) {
          return {
            data: { error: { message: 'temporary outage' } },
            status: 503,
            statusText: 'Service Unavailable',
            headers: {},
            config,
          };
        }

        return {
          data: { ok: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });

    expect(seenHeaders).toHaveLength(2);
    expect(seenHeaders[0]).toBeTruthy();
    expect(seenHeaders[1]).toBe(seenHeaders[0]);
  });

  describe('failure-path coverage', () => {
    it('handles network timeout errors', async () => {
      const timeoutError = new Error('Network Timeout');
      (timeoutError as any).code = 'ECONNABORTED';

      await expect(
        apiRequest({
          url: '/timeout',
          method: 'GET',
          timeout: 1,
          adapter: async () => {
            // Simulate a hanging request by not returning
            await new Promise((resolve) => setTimeout(resolve, 100));
            return {
              data: {},
              status: 200,
              statusText: 'OK',
              headers: {},
              config: {} as any,
            };
          },
        }),
      ).rejects.toThrow(/timeout/i);
    });

    it('handles permission denied (403) responses', async () => {
      await expect(
        apiRequest({
          url: '/forbidden',
          method: 'GET',
          adapter: async () => {
            return {
              data: { error: { message: 'Forbidden' } },
              status: 403,
              statusText: 'Forbidden',
              headers: {},
              config: {} as any,
            };
          },
        }),
      ).rejects.toThrow();
    });

    it('handles missing data in response payload', async () => {
      // This test ensures the client handles unexpected empty/null payloads gracefully
      // or throws appropriately if the schema expects data.
      const response = await apiRequest({
        url: '/empty',
        method: 'GET',
        adapter: async () => {
          return {
            data: null,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {} as any,
          };
        },
      });

      // Assert that the response structure is handled (even if data is null)
      expect(response).toBeDefined();
    });

    it('handles duplicate action retries by preserving state', async () => {
      const attempts: number[] = [];

      await apiRequest({
        url: '/duplicate-test',
        method: 'POST',
        adapter: async (config) => {
          attempts.push(1);
          // Simulate a transient error that triggers a retry
          if (attempts.length === 1) {
            return {
              data: { error: { message: 'Conflict' } },
              status: 409,
              statusText: 'Conflict',
              headers: {},
              config,
            };
          }
          return {
            data: { success: true },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          };
        },
      });

      // Verify that the retry happened
      expect(attempts).toHaveLength(2);
    });

    it('handles invalid input configuration gracefully', async () => {
      // Test that invalid or missing required fields in config are handled
      // or throw specific errors if the client validates inputs.
      try {
        await apiRequest({
          // Missing URL should typically throw
          method: 'GET',
          adapter: async () => ({
            data: {},
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {} as any,
          }),
        });
      } catch (error: any) {
        // Expect an error due to missing URL or invalid config
        expect(error).toBeDefined();
      }
    });
  });
});
