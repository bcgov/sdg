import type { TestInfo } from '@playwright/test';

export interface ReachabilityOptions {
  attempts?: number;
  intervalMs?: number;
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves true once `url` answers with any HTTP response, or false if it never does. With the defaults it gives up
 * after about 170s, longer than the ~2 minutes for which the Gold cluster drops a runner that opened too many
 * connections.
 */
export async function waitUntilReachable(
  url: string,
  {
    attempts = 12,
    intervalMs = 10_000,
    requestTimeoutMs = 5_000,
    fetch = globalThis.fetch,
    sleep = wait,
  }: ReachabilityOptions = {},
): Promise<boolean> {
  /** Polls one attempt at a time: each waits for the one before, so this recurses instead of looping. */
  const poll = async (attempt: number): Promise<boolean> => {
    try {
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(requestTimeoutMs) });
      if (attempt > 1) console.warn(`[retry-gate] ${url} reachable again (attempt ${attempt}/${attempts})`);
      return true;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      console.warn(`[retry-gate] ${url} unreachable (attempt ${attempt}/${attempts}): ${String(error)}${cause}`);
    }
    if (attempt >= attempts) return false;
    await sleep(intervalMs);
    return poll(attempt + 1);
  };
  return poll(1);
}

/**
 * Auto fixture body: before a retry, waits until the base URL answers, so a retry doesn't land in the same window in
 * which the cluster is refusing or dropping this runner's connections. First attempts start straight away.
 */
export async function retryGateFixture(
  { baseURL }: { baseURL: string | undefined },
  use: () => Promise<void>,
  testInfo: TestInfo,
  options?: ReachabilityOptions,
): Promise<void> {
  if (testInfo.retry > 0 && baseURL && !(await waitUntilReachable(baseURL, options))) {
    console.error(`[retry-gate] ${baseURL} still unreachable; running the retry anyway`);
  }
  await use();
}
