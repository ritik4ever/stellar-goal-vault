import { AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

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
});
