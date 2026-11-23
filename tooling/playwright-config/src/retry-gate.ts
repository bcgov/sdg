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
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling: each attempt waits for the one before.
      await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(requestTimeoutMs) });
      if (attempt > 1) console.warn(`[retry-gate] ${url} reachable again (attempt ${attempt}/${attempts})`);
      return true;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      console.warn(`[retry-gate] ${url} unreachable (attempt ${attempt}/${attempts}): ${String(error)}${cause}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- the pause between attempts.
    if (attempt < attempts) await sleep(intervalMs);
  }
  return false;
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
