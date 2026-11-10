import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Forwarder,
  FORWARD_TIMEOUT_MS,
  type ForwarderLogger,
  type ForwarderOptions,
  type ForwardRequest,
  type ForwardResult,
  type TokenResult,
} from './forwarder.js';

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

function portOf(listening: Server): number {
  const address = listening.address();
  if (address === null || typeof address === 'string') throw new Error('server is not listening on a port');
  return address.port;
}

let server: Server;
let upstream = '';
let received: Received[] = [];
let respond: RequestListener = (_req, res) => res.end('ok');

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  upstream = `http://127.0.0.1:${portOf(server)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  respond = (_req, res) => res.end('ok');
});

afterEach(() => {
  vi.useRealTimers();
});

interface Context {
  token: TokenResult;
}

function portalForwarder(overrides: Partial<ForwarderOptions<Context>> = {}) {
  const logger = { warn: vi.fn<ForwarderLogger['warn']>() };
  const token = vi.fn<(context: Context) => Promise<TokenResult>>(async (context) => context.token);
  const forwarder = new Forwarder<Context>({
    upstream,
    audiences: ['portal', 'shared'],
    token,
    logger,
    ...overrides,
  });
  return { forwarder, logger, token };
}

function request(url: string, init: Partial<ForwardRequest> = {}): ForwardRequest {
  return { method: 'GET', url, headers: {}, ...init };
}

const signedIn: Context = { token: { token: 'access-token' } };

function relayed(result: ForwardResult) {
  if (result.kind !== 'response') throw new Error(`expected a relayed response, got ${result.status}`);
  return { ...result, text: new TextDecoder().decode(result.body) };
}

describe('Forwarder routing', () => {
  it('answers 404 to another audience without calling core-api (AE2)', async () => {
    const { forwarder, token } = portalForwarder();
    const result = await forwarder.forward(request('/api/v1/admin/registry'), signedIn);
    expect(result).toEqual({ kind: 'rejected', status: 404 });
    expect(received).toEqual([]);
    expect(token).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/me', '/internal/principals/login', '/healthz/ready', '/api/v1/portal%2f../admin/x'])(
    'answers 404 to %s without calling core-api',
    async (url) => {
      const { forwarder } = portalForwarder();
      expect(await forwarder.forward(request(url), signedIn)).toEqual({ kind: 'rejected', status: 404 });
      expect(received).toEqual([]);
    },
  );

  it('would reach /internal through backslash dot segments, since fetch reads a backslash as a slash', () => {
    expect(new URL(`${upstream}/api/v1/portal/..\\..\\..\\internal/x`).pathname).toBe('/internal/x');
  });

  it.each([
    '/api/v1/portal/..\\..\\..\\internal/principals/login',
    '/api/v1/portal/..%5C..%5C..%5Cinternal/principals/login',
    '/api/v1/portal/..%5c..%5c..%5cinternal/principals/login',
  ])('answers 404 to the backslash traversal %s without calling core-api', async (url) => {
    const { forwarder, token } = portalForwarder();
    expect(await forwarder.forward(request(url), signedIn)).toEqual({ kind: 'rejected', status: 404 });
    expect(token).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it('answers 405 to a method outside the filter, before asking for a token', async () => {
    const { forwarder, token } = portalForwarder({ audiences: ['gateway'], methods: ['GET'] });
    const result = await forwarder.forward(request('/api/v1/gateway/x', { method: 'POST' }), signedIn);
    expect(result).toEqual({ kind: 'rejected', status: 405 });
    expect(token).not.toHaveBeenCalled();
    expect(received).toEqual([]);
  });

  it("answers with the token supplier's status when it has no token", async () => {
    const { forwarder } = portalForwarder();
    const result = await forwarder.forward(request('/api/v1/portal/x'), { token: { status: 401 } });
    expect(result).toEqual({ kind: 'rejected', status: 401 });
    expect(received).toEqual([]);
  });

  it('forwards the path and query unchanged, with the method and body', async () => {
    const { forwarder } = portalForwarder();
    const body = JSON.stringify({ name: 'a' });
    const result = await forwarder.forward(
      request('/api/v1/shared/files/a%20b?page=2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
      signedIn,
    );
    expect(relayed(result).status).toBe(200);
    expect(received).toEqual([
      expect.objectContaining({ method: 'POST', url: '/api/v1/shared/files/a%20b?page=2', body }),
    ]);
  });
});

describe('Forwarder request headers', () => {
  it('drops Cookie and a browser Authorization, sets the Bearer, and keeps only the allow-listed headers', async () => {
    const { forwarder } = portalForwarder();
    await forwarder.forward(
      request('/api/v1/portal/x', {
        headers: {
          accept: 'application/json',
          'accept-language': 'en-CA',
          'content-type': 'application/json',
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          tracestate: 'vendor=1',
          'x-request-id': 'req-1',
          authorization: 'Bearer browser-token',
          cookie: 'portal.sid=secret',
          'x-forwarded-for': '10.0.0.1',
          'x-custom': 'nope',
        },
      }),
      signedIn,
    );
    const headers = received[0]?.headers ?? {};
    expect(headers).toMatchObject({
      accept: 'application/json',
      'accept-language': 'en-CA',
      'content-type': 'application/json',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'vendor=1',
      'x-request-id': 'req-1',
      authorization: 'Bearer access-token',
    });
    expect(headers).not.toHaveProperty('cookie');
    expect(headers).not.toHaveProperty('x-forwarded-for');
    expect(headers).not.toHaveProperty('x-custom');
  });
});

describe('Forwarder responses', () => {
  it('relays status, body and headers, removing Set-Cookie and hop-by-hop headers', async () => {
    respond = (_req, res) => {
      res.writeHead(201, {
        'content-type': 'application/json',
        'set-cookie': 'core.sid=leak; HttpOnly',
        connection: 'keep-alive, x-hop',
        'keep-alive': 'timeout=5',
        'x-hop': 'per-connection',
        'x-upstream': 'yes',
      });
      res.end('{"id":1}');
    };
    const { forwarder } = portalForwarder();
    const result = relayed(await forwarder.forward(request('/api/v1/portal/x'), signedIn));
    expect(result.status).toBe(201);
    expect(result.text).toBe('{"id":1}');
    expect(result.headers.get('content-type')).toBe('application/json');
    expect(result.headers.get('x-upstream')).toBe('yes');
    for (const name of ['set-cookie', 'connection', 'keep-alive', 'x-hop', 'transfer-encoding']) {
      expect(result.headers.has(name)).toBe(false);
    }
  });

  it('relays a decoded body without the encoding and length it no longer has', async () => {
    respond = (_req, res) => {
      const body = gzipSync('compressed');
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length, 'content-type': 'text/plain' });
      res.end(body);
    };
    const { forwarder } = portalForwarder();
    const result = relayed(await forwarder.forward(request('/api/v1/portal/x'), signedIn));
    expect(result.text).toBe('compressed');
    expect(result.headers.has('content-encoding')).toBe(false);
    expect(result.headers.has('content-length')).toBe(false);
  });

  it('relays a redirect instead of following it', async () => {
    respond = (req, res) => {
      if (req.url === '/elsewhere') res.end('followed');
      else res.writeHead(302, { location: '/elsewhere' }).end();
    };
    const { forwarder } = portalForwarder();
    const result = relayed(await forwarder.forward(request('/api/v1/portal/x'), signedIn));
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('/elsewhere');
    expect(received.map((r) => r.url)).toEqual(['/api/v1/portal/x']);
  });

  it('relays a 401 from core-api for the caller to act on', async () => {
    respond = (_req, res) => res.writeHead(401).end();
    const { forwarder } = portalForwarder();
    expect(relayed(await forwarder.forward(request('/api/v1/portal/x'), signedIn)).status).toBe(401);
  });
});

describe('Forwarder when core-api is unavailable', () => {
  it('answers 503 and logs the cause when the connection is refused', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = portOf(closed);
    await new Promise((resolve) => closed.close(resolve));
    const { forwarder, logger } = portalForwarder({ upstream: `http://127.0.0.1:${port}` });
    const result = await forwarder.forward(request('/api/v1/portal/x'), signedIn);
    expect(result).toEqual({ kind: 'rejected', status: 503 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('GET'),
        error: expect.objectContaining({ type: 'TypeError' }),
      }),
    );
  });

  it(`answers 503 when core-api takes longer than ${FORWARD_TIMEOUT_MS} ms`, async () => {
    expect(FORWARD_TIMEOUT_MS).toBe(10_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hanging = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const { forwarder, logger } = portalForwarder({ fetch: hanging });
    let result: ForwardResult | undefined;
    const pending = forwarder.forward(request('/api/v1/portal/x'), signedIn).then((value) => {
      result = value;
      return value;
    });
    await vi.advanceTimersByTimeAsync(FORWARD_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result).toEqual({ kind: 'rejected', status: 503 });
    expect(hanging).toHaveBeenCalledWith(
      `${upstream}/api/v1/portal/x`,
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
