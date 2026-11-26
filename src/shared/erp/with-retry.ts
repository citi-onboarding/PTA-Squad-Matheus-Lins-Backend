import { ErpRequestError, RateLimitedError } from "./erp-errors.js";

const MAX_RETRIES = 3;
const BACKOFF_SECONDS = [1, 2, 4];
const DEFAULT_RETRY_AFTER_SECONDS = 5;
const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * Returns how many seconds to wait before retrying `error`, or `undefined` when
 * it must not be retried. Throws `RateLimitedError` when the ERP asks to wait
 * longer than the caller should block.
 */
function retryDelaySeconds(error: unknown, retry: number): number | undefined {
  if (!(error instanceof ErpRequestError)) {
    return undefined;
  }

  const status = error.status ?? 0;
  if (error.kind === "http" && (status === 429 || status === 503)) {
    const seconds = error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    if (seconds > MAX_RETRY_AFTER_SECONDS) {
      throw new RateLimitedError(seconds);
    }
    return seconds;
  }

  if (error.kind === "http" && status < 500) {
    return undefined;
  }

  return BACKOFF_SECONDS[retry];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs `call`, retrying ERP failures: 429/503 after `Retry-After` (5 s when
 * absent), other 5xx, timeouts, network failures, and malformed pages after
 * 1, 2, and 4 seconds. Makes at most 4 calls and rethrows the last error.
 */
export async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await call();
    } catch (error) {
      const delaySeconds = retryDelaySeconds(error, retry);
      if (delaySeconds === undefined || retry >= MAX_RETRIES) {
        throw error;
      }
      await sleep(delaySeconds * 1_000);
    }
  }
}
