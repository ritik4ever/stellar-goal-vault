import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export const REQUEST_ID_HEADER = 'X-Request-ID';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: {
    Accept: 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const headers = config.headers ?? {};
  const existingRequestId = headers[REQUEST_ID_HEADER];
  const requestId =
    typeof existingRequestId === 'string' && existingRequestId.trim().length > 0
      ? existingRequestId
      : createRequestId();

  headers[REQUEST_ID_HEADER] = requestId;
  config.headers = headers;
  return config;
});

export async function apiRequest<T>(config: AxiosRequestConfig): Promise<T> {
  let lastError: unknown;
  let requestId: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await apiClient.request<T>({
        ...config,
        headers: {
          ...(config.headers ?? {}),
          ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
        },
        validateStatus: () => true,
      });

      requestId =
        (response.config.headers?.[REQUEST_ID_HEADER] as string | undefined) ?? requestId;

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (response.status >= 400) {
        const body = response.data as {
          error?: {
            code?: string;
            message?: string;
            details?: Array<{ field: string; message: string }>;
            requestId?: string;
          };
        };
        const error = new Error(body.error?.message ?? 'Unexpected API error');
        (error as Error & { code?: string }).code = body.error?.code;
        (error as Error & { details?: Array<{ field: string; message: string }> }).details =
          body.error?.details;
        (error as Error & { requestId?: string }).requestId =
          body.error?.requestId ?? requestId;
        throw error;
      }

      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}
