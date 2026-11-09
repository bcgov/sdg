import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { principals } from '@repo/portal-database';
import type supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { json, signIn, startUpstream, type Upstream } from '../testing/notification-upstream.js';

const STREAM_PATH = '/api/v1/notifications/inbox/stream';
const OPEN = ': open\n\n';
const KEEP_ALIVE = ': keep-alive\n\n';
const CHANGED = 'event: changed\ndata: {}\n\n';
/** The idle limit for these tests (SESSION_TTL_SECONDS). */
const TTL_SECONDS = 600;
const MINUTE = 60_000;

interface OpenUpstream {
  res: ServerResponse;
  accept: string | undefined;
  /** Resolves when the connection from portal-api closes. */
  closed: Promise<void>;
}

interface ClientStream {
  response: Response;
  /** Reads until the received text contains `wanted`; throws when the stream ends first. */
  readUntil: (wanted: string) => Promise<string>;
  /** Reads to a clean end and returns everything received; rejects when the connection is cut instead. */
  readToEnd: () => Promise<string>;
  abort: () => void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function listen(t: TestApp): Promise<string> {
  await t.app.listen(0, '127.0.0.1');
  const address: AddressInfo | string | null = t.app.getHttpServer().address();
  if (address === null || typeof address === 'string') throw new Error('portal-api did not bind a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

/** Signs in and returns the agent plus its session cookie, for clients that read the stream as it arrives. */
async function signedIn(t: TestApp): Promise<{ agent: supertest.Agent; cookie: string }> {
  const agent = await signIn(t);
  const cookie: string | undefined = (await agent.get('/api/auth/me')).headers['set-cookie']?.[0]?.split(';')[0];
  if (cookie === undefined) throw new Error('signed-in response carried no session cookie');
  return { agent, cookie };
}

async function openClient(baseUrl: string, cookie: string): Promise<ClientStream> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${STREAM_PATH}`, { headers: { cookie }, signal: controller.signal });
  if (response.body === null) throw new Error('stream response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  /** Reads chunks until `stop(text)`; resolves with whether it stopped there rather than at the end of the stream. */
  const read = async (stop: (received: string) => boolean): Promise<boolean> => {
    if (stop(text)) return true;
    const { done, value } = await reader.read();
    if (done) return false;
    text += decoder.decode(value, { stream: true });
    return read(stop);
  };
  return {
    response,
    readUntil: async (wanted) => {
      if (!(await read((received) => received.includes(wanted)))) {
        throw new Error(`stream ended before ${JSON.stringify(wanted)}: ${text}`);
      }
      return text;
    },
    readToEnd: async () => {
      await read(() => false);
      return text;
    },
    abort: () => controller.abort(),
  };
}

describe('notification relay stream', () => {
  let t: TestApp;
  let upstream: Upstream;
  let baseUrl: string;
  const opened: ServerResponse[] = [];
  const clients: ClientStream[] = [];

  /** Answers the next upstream request as an open SSE stream, the way notification-api does. */
  function upstreamStream(): Promise<OpenUpstream> {
    const { promise, resolve } = Promise.withResolvers<OpenUpstream>();
    upstream.respond.with = (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      res.write(OPEN);
      opened.push(res);
      resolve({ res, accept: req.headers.accept, closed: new Promise((done) => res.on('close', done)) });
    };
    return promise;
  }

  async function openStream(cookie: string, app: { baseUrl: string } = { baseUrl }) {
    const opening = upstreamStream();
    const client = await openClient(app.baseUrl, cookie);
    clients.push(client);
    return { client, up: await opening };
  }

  beforeAll(async () => {
    upstream = await startUpstream();
    t = await createTestApp({ env: { NOTIFICATION_API_URL: upstream.url, SESSION_TTL_SECONDS: String(TTL_SECONDS) } });
    baseUrl = await listen(t);
  });

  afterAll(async () => {
    await t.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  });

  beforeEach(async () => {
    resetOidcStub(t.oidc);
    upstream.received.length = 0;
    upstream.respond.with = json;
    await t.database.db.delete(principals);
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const client of clients.splice(0)) client.abort();
    for (const res of opened.splice(0)) res.end();
  });

  it("relays to the user's inbox stream with the session access token and streaming headers", async () => {
    const { cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    expect(client.response.status).toBe(200);
    expect(client.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(client.response.headers.get('cache-control')).toContain('no-transform');
    expect(client.response.headers.get('x-accel-buffering')).toBe('no');
    expect(up.accept).toBe('text/event-stream');
    expect(upstream.received).toEqual([
      expect.objectContaining({ method: 'GET', url: '/api/v1/me/inbox/stream', authorization: 'Bearer access-token' }),
    ]);
  });

  it('delivers an event written after 500 ms before the upstream ends (no buffering)', async () => {
    const { cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    setTimeout(() => up.res.write(CHANGED), 500);
    expect(await client.readUntil(CHANGED)).toBe(`${OPEN}${CHANGED}`);
    expect(up.res.writableEnded).toBe(false);
  });

  it('aborts the upstream request when the client goes away', async () => {
    const { cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);
    await client.readUntil(OPEN);

    client.abort();
    await up.closed;
    expect(up.res.writableEnded).toBe(false);
  });

  it('aborts the upstream request when the client leaves before the upstream headers arrive', async () => {
    const { cookie } = await signedIn(t);
    const { promise: arrived, resolve } = Promise.withResolvers<ServerResponse>();
    upstream.respond.with = (_req, res) => resolve(res);
    const controller = new AbortController();
    const request = fetch(`${baseUrl}${STREAM_PATH}`, { headers: { cookie }, signal: controller.signal }).catch(
      () => undefined,
    );
    const res = await arrived;
    controller.abort();
    await request;
    await delay(100);

    const closed = new Promise<'closed'>((done) => res.on('close', () => done('closed')));
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.write(OPEN);
    opened.push(res);
    expect(await Promise.race([closed, delay(2_000).then(() => 'still open')])).toBe('closed');
  });

  it('ends the client response cleanly when the upstream ends', async () => {
    const { cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    up.res.end(CHANGED);
    expect(await client.readToEnd()).toBe(`${OPEN}${CHANGED}`);
  });

  it('passes an upstream 401 through, answers 502 when notification-api is unreachable, 401 when signed out', async () => {
    const { agent } = await signedIn(t);
    upstream.respond.with = (_req, res) =>
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"message":"Unauthorized"}');
    const rejected = await agent.get(STREAM_PATH);
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({ message: 'Unauthorized' });

    upstream.respond.with = (req) => req.socket.destroy();
    expect((await agent.get(STREAM_PATH)).status).toBe(502);

    upstream.received.length = 0;
    expect((await t.http().get(STREAM_PATH)).status).toBe(401);
    expect(upstream.received).toEqual([]);
  });

  it('keeps a stream open past the JSON relay timeout', { timeout: 25_000 }, async () => {
    const { cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    await delay(15_000);
    up.res.write(CHANGED);
    expect(await client.readUntil(CHANGED)).toBe(`${OPEN}${CHANGED}`);
  });

  it('ends an open stream at the next upstream keep-alive once the user signs out', async () => {
    const { agent, cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    // A keep-alive while the session lives leaves the stream open.
    up.res.write(KEEP_ALIVE);
    await delay(250);
    up.res.write(CHANGED);
    await client.readUntil(CHANGED);

    expect((await agent.post('/api/auth/logout')).status).toBe(200);
    up.res.write(KEEP_ALIVE);
    expect(await client.readToEnd()).toBe(`${OPEN}${KEEP_ALIVE}${CHANGED}${KEEP_ALIVE}`);
    await up.closed;
  });

  it('ends an open stream at the next upstream keep-alive once the session is idle-expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const { agent, cookie } = await signedIn(t);
    const { client, up } = await openStream(cookie);

    // Background requests keep the stored session alive past the idle limit without restarting its clock.
    for (const minute of [4, 8]) {
      vi.setSystemTime(start + minute * MINUTE);
      // oxlint-disable-next-line no-await-in-loop -- each request runs at its own time.
      expect((await agent.get('/api/auth/me').set('sdg-background', '1')).status).toBe(200);
    }
    up.res.write(KEEP_ALIVE);
    await delay(250);
    up.res.write(CHANGED);
    await client.readUntil(CHANGED);

    vi.setSystemTime(start + TTL_SECONDS * 1000 + MINUTE / 2);
    up.res.write(KEEP_ALIVE);
    expect(await client.readToEnd()).toBe(`${OPEN}${KEEP_ALIVE}${CHANGED}${KEEP_ALIVE}`);
    await up.closed;
  });

  describe('on shutdown', () => {
    it('ends every open stream so the server can close', async () => {
      const other = await createTestApp({ env: { NOTIFICATION_API_URL: upstream.url } });
      const otherUrl = await listen(other);
      const { cookie } = await signedIn(other);
      const { client, up } = await openStream(cookie, { baseUrl: otherUrl });

      const closing = other.close();
      expect(await client.readToEnd()).toBe(OPEN);
      await closing;
      await up.closed;
    });
  });
});
