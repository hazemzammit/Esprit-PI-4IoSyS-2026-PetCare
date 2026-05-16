import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { logger } from './logger';

/** Default inter-service HTTP timeout in ms */
const DEFAULT_TIMEOUT = 5000;

/** Max retries for transient failures */
const DEFAULT_RETRIES = 2;

/** Delay between retries (ms) — doubles each attempt */
const BASE_RETRY_DELAY = 300;

/**
 * Create a pre-configured axios instance with:
 *   - connect + response timeout
 *   - automatic retry with exponential backoff on 5xx / network errors
 *   - correlation-id propagation from incoming request
 *
 * Services should use this instead of bare `axios.get()`.
 */
export function createServiceClient(
  baseURL: string,
  opts?: { timeout?: number; retries?: number },
): AxiosInstance {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = opts?.retries ?? DEFAULT_RETRIES;

  const client = axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-caller': process.env.SERVICE_NAME ?? 'unknown-service',
      // Propagate internal API key for /internal/* route protection.
      // Each service reads this from its own INTERNAL_API_KEY env var.
      ...(process.env.INTERNAL_API_KEY
        ? { 'x-internal-key': process.env.INTERNAL_API_KEY }
        : {}),
    },
  });

  // ── Response interceptor: retry on transient errors ───────────────────
  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as AxiosRequestConfig & { __retryCount?: number };
    if (!config) return Promise.reject(error);

    config.__retryCount = config.__retryCount ?? 0;

    const isRetryable =
      !error.response || // network / timeout
      (error.response.status >= 500 && error.response.status < 600);

    if (isRetryable && config.__retryCount < maxRetries) {
      config.__retryCount += 1;
      const delay = BASE_RETRY_DELAY * Math.pow(2, config.__retryCount - 1);
      logger.warn(
        `[httpClient] Retry ${config.__retryCount}/${maxRetries} → ${config.baseURL}${config.url} (delay ${delay}ms)`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return client.request(config);
    }

    return Promise.reject(error);
  });

  return client;
}
