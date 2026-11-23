import type { TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, type Mock, type MockInstance, vi } from 'vitest';

import { retryGateFixture, waitUntilReachable } from './retry-gate.ts';

const URL = 'https://sdg-82.apps.gold.devops.gov.bc.ca/';

function refused(): Error {
  return new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 142.34.229.4:443') });
}

/** A fetch that fails `failures` times, then answers. */
function fetchFailing(failures: number) {
  let calls = 0;
  return vi.fn<typeof globalThis.fetch>(async () => {
    calls += 1;
    if (calls <= failures) throw refused();
    return new Response(null, { status: 200 });
  });
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- retryGateFixture reads only retry.
const attempt = (retry: number) => ({ retry }) as unknown as TestInfo;

let sleep: Mock<(ms: number) => Promise<void>>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('waitUntilReachable', () => {
  it('returns at once, without waiting or logging, when the URL answers', async () => {
    const fetch = fetchFailing(0);
    await expect(waitUntilReachable(URL, { fetch, sleep })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'HEAD' }));
    expect(sleep).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts any HTTP answer, an error status included, as reachable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 503 }));
    await expect(waitUntilReachable(URL, { fetch, sleep })).resolves.toBe(true);
  });

  it('retries every interval, logging each failure with its cause, until the URL answers', async () => {
    const fetch = fetchFailing(2);
    await expect(waitUntilReachable(URL, { fetch, sleep, intervalMs: 10_000 })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10_000], [10_000]]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      `[retry-gate] ${URL} unreachable (attempt 1/12): TypeError: fetch failed: connect ECONNREFUSED 142.34.229.4:443`,
      `[retry-gate] ${URL} unreachable (attempt 2/12): TypeError: fetch failed: connect ECONNREFUSED 142.34.229.4:443`,
      `[retry-gate] ${URL} reachable again (attempt 3/12)`,
    ]);
  });

  it('gives up after the last attempt without a final wait', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    await expect(waitUntilReachable(URL, { fetch, sleep, attempts: 3 })).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      `[retry-gate] ${URL} unreachable (attempt 3/3): Error: The operation was aborted due to timeout`,
    );
  });

  it('sleeps for real by default', async () => {
    vi.useFakeTimers();
    try {
      const result = waitUntilReachable(URL, { fetch: fetchFailing(1), intervalMs: 10_000 });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(result).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retryGateFixture', () => {
  it('runs a first attempt without checking the URL', async () => {
    const fetch = fetchFailing(0);
    const use = vi.fn<() => Promise<void>>(async () => {});
    await retryGateFixture({ baseURL: URL }, use, attempt(0), { fetch, sleep });
    expect(fetch).not.toHaveBeenCalled();
    expect(use).toHaveBeenCalledOnce();
  });

  it('runs a retry once the URL answers again', async () => {
    const fetch = fetchFailing(0);
    const order: string[] = [];
    fetch.mockImplementationOnce(async () => {
      order.push('fetch');
      throw refused();
    });
    const use = vi.fn<() => Promise<void>>(async () => {
      order.push('use');
    });
    await retryGateFixture({ baseURL: URL }, use, attempt(1), { fetch, sleep });
    expect(order).toEqual(['fetch', 'use']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still runs the retry, with an error logged, when the URL never answers', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw refused();
    });
    const use = vi.fn<() => Promise<void>>(async () => {});
    await retryGateFixture({ baseURL: URL }, use, attempt(2), { fetch, sleep, attempts: 2 });
    expect(error).toHaveBeenCalledWith(`[retry-gate] ${URL} still unreachable; running the retry anyway`);
    expect(use).toHaveBeenCalledOnce();
  });

  it('skips the check when there is no base URL', async () => {
    const use = vi.fn<() => Promise<void>>(async () => {});
    await retryGateFixture({ baseURL: undefined }, use, attempt(1), { fetch: fetchFailing(0), sleep });
    expect(use).toHaveBeenCalledOnce();
  });
});
