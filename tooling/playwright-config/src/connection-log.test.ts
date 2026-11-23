import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserContext, Request, TestInfo } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectionLogFixture, logConnections } from './connection-log.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- logConnections reads only titlePath and retry.
const testInfo = { titlePath: ['home.spec.ts', 'home', 'loads'], retry: 1 } as unknown as TestInfo;

/** An EventEmitter stands in for the context: logConnections only calls on(). */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
const asContext = (emitter: EventEmitter) => emitter as unknown as BrowserContext;

/** A response whose server address can't be read because the page has closed. */
async function closedResponse() {
  return {
    serverAddr: async (): Promise<never> => {
      throw new Error('Target page, context or browser has been closed');
    },
  };
}
const START = Date.parse('2026-11-23T15:33:04.000Z');

interface FakeRequest {
  url?: string;
  connectStart?: number;
  response?: () => Promise<unknown>;
  failure?: { errorText: string } | null;
}

function request({ url = 'https://sdg.test/', connectStart = 10, response, failure = null }: FakeRequest): Request {
  const fake = {
    url: () => url,
    timing: () => ({ startTime: START, connectStart, connectEnd: connectStart + 42.4 }),
    response: response ?? (async () => ({ serverAddr: async () => ({ ipAddress: '142.34.229.4', port: 443 }) })),
    failure: () => failure,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- logConnections calls only these four methods.
  return fake as unknown as Request;
}

/** Lets the `response().then(serverAddr)` chain settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

let dir: string;
let file: string;
let context: EventEmitter;
const lines = () =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line): unknown => JSON.parse(line))
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'connection-log-'));
  file = join(dir, 'connections.ndjson');
  context = new EventEmitter();
  logConnections(asContext(context), testInfo, file);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('logConnections', () => {
  it('logs a new connection with its time, URL, connect time, server IP, test and retry', async () => {
    context.emit('requestfinished', request({ url: 'https://sdg.test/assets/app.js' }));
    await settle();
    expect(lines()).toEqual([
      {
        test: 'home.spec.ts › home › loads',
        retry: 1,
        at: '2026-11-23T15:33:04.000Z',
        event: 'connect',
        url: 'https://sdg.test/assets/app.js',
        connectMs: 42,
        ip: '142.34.229.4',
      },
    ]);
  });

  it('skips a request on a reused connection or from cache', async () => {
    context.emit('requestfinished', request({ connectStart: -1 }));
    context.emit('requestfinished', request({ url: 'https://sdg.test/new' }));
    await settle();
    expect(lines().map((line) => line['url'])).toEqual(['https://sdg.test/new']);
  });

  it('logs a null IP when there is no response', async () => {
    context.emit('requestfinished', request({ response: async () => null }));
    await settle();
    expect(lines()[0]).toMatchObject({ event: 'connect', ip: null });
  });

  it('still logs the connection, with the error, when the server address cannot be read', async () => {
    context.emit('requestfinished', request({ response: closedResponse }));
    await settle();
    expect(lines()[0]).toMatchObject({
      event: 'connect',
      ip: null,
      addrError: 'Error: Target page, context or browser has been closed',
    });
  });

  it("logs a failed request with the browser's error", () => {
    vi.useFakeTimers({ now: START });
    context.emit('requestfailed', request({ failure: { errorText: 'net::ERR_CONNECTION_REFUSED' } }));
    vi.useRealTimers();
    expect(lines()).toEqual([
      {
        test: 'home.spec.ts › home › loads',
        retry: 1,
        at: '2026-11-23T15:33:04.000Z',
        event: 'failed',
        url: 'https://sdg.test/',
        error: 'net::ERR_CONNECTION_REFUSED',
      },
    ]);
  });

  it('logs a null error when the failure has no text', () => {
    context.emit('requestfailed', request({ failure: null }));
    expect(lines()[0]).toMatchObject({ event: 'failed', error: null });
  });

  it('reports a file it cannot write to instead of throwing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = join(dir, 'no-such-dir', 'connections.ndjson');
    const other = new EventEmitter();
    logConnections(asContext(other), testInfo, missing);
    expect(() => other.emit('requestfailed', request({}))).not.toThrow();
    expect(error).toHaveBeenCalledWith(`[connection-log] cannot write ${missing}`, expect.any(Error));
  });
});

describe('connectionLogFixture', () => {
  it('attaches no listeners when E2E_CONNECTION_LOG is unset, and runs the test', async () => {
    vi.stubEnv('E2E_CONNECTION_LOG', '');
    const fresh = new EventEmitter();
    const use = vi.fn<() => Promise<void>>(async () => {});
    await connectionLogFixture({ context: asContext(fresh) }, use, testInfo);
    expect(use).toHaveBeenCalledOnce();
    expect(fresh.eventNames()).toEqual([]);
  });

  it('logs to the file E2E_CONNECTION_LOG names', async () => {
    const fixtureFile = join(dir, 'fixture.ndjson');
    vi.stubEnv('E2E_CONNECTION_LOG', fixtureFile);
    const fresh = new EventEmitter();
    await connectionLogFixture(
      { context: asContext(fresh) },
      async () => {
        fresh.emit('requestfailed', request({ failure: { errorText: 'net::ERR_CONNECTION_REFUSED' } }));
      },
      testInfo,
    );
    expect(readFileSync(fixtureFile, 'utf8')).toContain('"error":"net::ERR_CONNECTION_REFUSED"');
  });
});
