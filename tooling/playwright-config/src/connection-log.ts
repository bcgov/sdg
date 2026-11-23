import { appendFileSync } from 'node:fs';

import type { BrowserContext, Request, TestInfo } from '@playwright/test';

/**
 * Appends one JSON line per new TCP connection and per failed request in `context` to `file`, to measure how many
 * connections a run opens before the Gold cluster starts refusing them (ERR_CONNECTION_REFUSED). A request on a reused
 * connection, or served from cache, has `connectStart` -1 and is not logged.
 */
export function logConnections(context: BrowserContext, testInfo: TestInfo, file: string): void {
  const base = { test: testInfo.titlePath.join(' › '), retry: testInfo.retry };
  const write = (entry: Record<string, unknown>) => {
    try {
      appendFileSync(file, `${JSON.stringify({ ...base, ...entry })}\n`);
    } catch (error) {
      console.error(`[connection-log] cannot write ${file}`, error);
    }
  };

  context.on('requestfinished', (request: Request) => {
    const timing = request.timing();
    if (timing.connectStart < 0) return;
    const entry = {
      at: new Date(timing.startTime).toISOString(),
      event: 'connect',
      url: request.url(),
      connectMs: Math.round(timing.connectEnd - timing.connectStart),
    };
    request
      .response()
      .then((response) => response?.serverAddr())
      .then((addr) => write({ ...entry, ip: addr?.ipAddress ?? null }))
      .catch((error: unknown) => write({ ...entry, ip: null, addrError: String(error) }));
  });

  context.on('requestfailed', (request: Request) => {
    write({
      at: new Date().toISOString(),
      event: 'failed',
      url: request.url(),
      error: request.failure()?.errorText ?? null,
    });
  });
}
