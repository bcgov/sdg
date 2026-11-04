import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { generateWebhookSecret, verifyWebhook, type WebhookHeaders } from '../crypto/signing.js';
import { sendWebhook } from '../integrations/types/webhook.js';
import { GuardedHttpClient } from './http-dispatcher.js';
import { OutboundGuard, type HostLookup } from './outbound-guard.js';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** A receiver on 127.0.0.1: `/redirect` answers 302 to `/elsewhere`, anything else 204. */
let server: Server;
let port: number;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      if (req.url === '/redirect') res.writeHead(302, { location: '/elsewhere' }).end();
      else res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The receiver is not on a TCP port');
  port = address.port;
});

afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

afterEach(() => {
  received.length = 0;
});

/** `hooks.local` (allow-listed) and `intranet.example.com` (not) both resolve to the receiver's 127.0.0.1. */
const lookup: HostLookup = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);

function client(allowHosts: string[]): GuardedHttpClient {
  return new GuardedHttpClient(new OutboundGuard({ allowHosts, lookup }));
}

describe('sendWebhook through the guarded dispatcher', () => {
  it('connects to the vetted address, keeps the original Host, and signs with the delivery ID', async () => {
    const http = client(['hooks.local']);
    const secret = generateWebhookSecret();
    const body = '{"type":"permit-approved"}';

    const outcome = await sendWebhook(http, {
      url: `http://hooks.local:${port}/notify`,
      secret,
      deliveryId: 'delivery-123',
      body,
    });

    expect(outcome).toEqual({ status: 'accepted' });
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request?.headers.host).toBe(`hooks.local:${port}`);
    expect(request?.headers['webhook-id']).toBe('delivery-123');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.body).toBe(body);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the receiver got the three signing headers.
    const headers = request?.headers as unknown as WebhookHeaders;
    expect(verifyWebhook({ secret, headers, body })).toBe(true);
    await http.close();
  });

  it('does not follow a redirect', async () => {
    const http = client(['hooks.local']);

    const outcome = await http.post({ url: `http://hooks.local:${port}/redirect`, headers: {}, body: '{}' });

    expect(outcome).toEqual({ status: 'failed', retryable: false, error: 'HTTP 302: redirect not followed' });
    expect(received.map((request) => request.path)).toEqual(['/redirect']);
    await http.close();
  });

  it('never connects to a host that resolves to a private address', async () => {
    const http = client([]);

    const outcome = await http.post({ url: `https://intranet.example.com:${port}/notify`, headers: {}, body: '{}' });

    expect(outcome).toEqual({
      status: 'failed',
      retryable: false,
      error: 'intranet.example.com resolves to a non-public address',
    });
    expect(received).toEqual([]);
    await http.close();
  });

  it('refuses an http:// URL to a host that is not allow-listed', async () => {
    const http = client([]);

    const outcome = await http.post({ url: `http://127.0.0.1:${port}/notify`, headers: {}, body: '{}' });

    expect(outcome).toEqual({ status: 'failed', retryable: false, error: 'Must be an https:// URL' });
    expect(received).toEqual([]);
    await http.close();
  });
});
