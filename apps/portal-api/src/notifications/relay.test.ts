import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AuthError, type OidcTokens } from '@repo/auth';
import { principals } from '@repo/portal-database';
import type supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';

interface Received {
  method: string;
  url: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const json: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ items: [] }));
};

/** A stand-in notification-api on a loopback port that records every request it receives. */
async function startUpstream(): Promise<{
  url: string;
  received: Received[];
  respond: { with: Handler };
  server: Server;
}> {
  const received: Received[] = [];
  const respond = { with: json };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      respond.with(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('upstream did not bind a TCP port');
  // The trailing slash also checks that portal-api strips it from NOTIFICATION_API_URL.
  return { url: `http://127.0.0.1:${address.port}/`, received, respond, server };
}

function tokens(overrides: Partial<OidcTokens> = {}): OidcTokens {
  return {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: null,
    ...overrides,
  };
}

describe('notification relay', () => {
  let t: TestApp;
  let upstream: Awaited<ReturnType<typeof startUpstream>>;

  beforeAll(async () => {
    upstream = await startUpstream();
    t = await createTestApp({ env: { NOTIFICATION_API_URL: upstream.url } });
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

  /** Signs in through the stubbed login flow with the given session tokens. */
  async function signIn(sessionTokens: OidcTokens = tokens()): Promise<supertest.Agent> {
    t.oidc.handleCallback.mockResolvedValue({
      user: {
        issuer: 'https://keycloak.example.com/realms/portal',
        subject: 'sub-1',
        name: 'Ada',
        email: null,
        emailVerified: false,
        username: null,
        claims: {},
      },
      tokens: sessionTokens,
    });
    const agent = t.http();
    await agent.get('/api/auth/login');
    await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
    return agent;
  }

  describe('recipient routes', () => {
    it('forwards to /api/v1/me with the session access token and returns the upstream response', async () => {
      const agent = await signIn();
      const list = await agent.get('/api/v1/notifications/contact-points?page=2');
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ items: [] });
      expect(list.headers['content-type']).toBe('application/json; charset=utf-8');

      upstream.respond.with = (_req, res) => res.writeHead(204).end();
      const patch = await agent.patch('/api/v1/notifications').send({ language: 'fr' });
      expect(patch.status).toBe(204);

      expect(upstream.received).toEqual([
        expect.objectContaining({
          method: 'GET',
          url: '/api/v1/me/contact-points?page=2',
          authorization: 'Bearer access-token',
          body: '',
        }),
        {
          method: 'PATCH',
          url: '/api/v1/me',
          authorization: 'Bearer access-token',
          contentType: 'application/json',
          body: '{"language":"fr"}',
        },
      ]);
    });

    it('passes upstream errors through and does not follow redirects', async () => {
      const agent = await signIn();
      upstream.respond.with = (_req, res) =>
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"message":"bad"}');
      const rejected = await agent.post('/api/v1/notifications/contact-points').send({ channel: 'email' });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toEqual({ message: 'bad' });

      upstream.respond.with = (_req, res) => res.writeHead(302, { location: '/api/v1/admin/senders' }).end();
      expect((await agent.get('/api/v1/notifications/subscriptions')).status).toBe(502);
      expect(upstream.received.map(({ url }) => url)).toEqual([
        '/api/v1/me/contact-points',
        '/api/v1/me/subscriptions',
      ]);
    });

    it('returns 502 when notification-api is unreachable', async () => {
      const agent = await signIn();
      upstream.respond.with = (req) => req.socket.destroy();
      const res = await agent.get('/api/v1/notifications/contact-points');
      expect(res.status).toBe(502);
    });

    it('never relays outside /api/v1/me', async () => {
      const agent = await signIn();
      expect((await agent.get('/api/v1/notifications/%2e%2e/admin/senders')).status).toBe(404);
      expect(upstream.received).toEqual([]);
    });

    it('rejects a request without a session and does not call notification-api', async () => {
      const res = await t.http().get('/api/v1/notifications/contact-points');
      expect(res.status).toBe(401);
      expect(upstream.received).toEqual([]);
    });
  });

  describe('token refresh', () => {
    it('refreshes a token expiring in 10 seconds before relaying and saves the new tokens', async () => {
      const agent = await signIn(tokens({ expiresAt: Date.now() + 10_000 }));
      expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(200);
      expect(t.oidc.refresh).toHaveBeenCalledTimes(1);
      expect(t.oidc.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'refresh-token' }));
      // The second request reads the saved session: the refreshed token, still fresh, so no second refresh.
      expect((await agent.get('/api/v1/notifications/subscriptions')).status).toBe(200);
      expect(t.oidc.refresh).toHaveBeenCalledTimes(1);
      expect(upstream.received.map(({ authorization }) => authorization)).toEqual([
        'Bearer refreshed-access-token',
        'Bearer refreshed-access-token',
      ]);
    });

    it('does not refresh a token with more than 30 seconds left', async () => {
      const agent = await signIn(tokens({ expiresAt: Date.now() + 60_000 }));
      await agent.get('/api/v1/notifications/contact-points');
      expect(t.oidc.refresh).not.toHaveBeenCalled();
      expect(upstream.received[0]?.authorization).toBe('Bearer access-token');
    });

    it('refreshes once for two concurrent requests', async () => {
      const agent = await signIn(tokens({ expiresAt: Date.now() + 10_000 }));
      const idp = Promise.withResolvers<OidcTokens>();
      t.oidc.refresh.mockReturnValue(idp.promise);
      const both = Promise.all([
        agent.get('/api/v1/notifications/contact-points'),
        agent.get('/api/v1/notifications/subscriptions'),
      ]);
      await expect.poll(() => t.oidc.refresh.mock.calls.length).toBe(1);
      // Give the second request time to reach the refresh while the first one is still waiting on the IdP.
      await new Promise((resolve) => setTimeout(resolve, 100));
      idp.resolve(tokens({ accessToken: 'refreshed-once', expiresAt: Date.now() + 300_000 }));
      const responses = await both;
      expect(responses.map(({ status }) => status)).toEqual([200, 200]);
      expect(t.oidc.refresh).toHaveBeenCalledTimes(1);
      expect(upstream.received.map(({ authorization }) => authorization)).toEqual([
        'Bearer refreshed-once',
        'Bearer refreshed-once',
      ]);
    });

    it('returns 401 and destroys the session when the refresh fails', async () => {
      const agent = await signIn(tokens({ expiresAt: Date.now() + 10_000 }));
      t.oidc.refresh.mockRejectedValue(new AuthError('refresh_failed', { detail: 'invalid_grant' }));
      expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(401);
      expect(upstream.received).toEqual([]);
      expect((await agent.get('/api/auth/me')).status).toBe(401);
    });
  });

  describe('POST /api/v1/contact-points/confirm', () => {
    it('forwards the token without a session or bearer token', async () => {
      upstream.respond.with = (_req, res) => res.writeHead(204).end();
      const res = await t.http().post('/api/v1/contact-points/confirm').send({ token: 'link-token' });
      expect(res.status).toBe(204);
      expect(upstream.received).toEqual([
        {
          method: 'POST',
          url: '/api/v1/contact-points/confirm',
          authorization: undefined,
          contentType: 'application/json',
          body: '{"token":"link-token"}',
        },
      ]);
    });

    it('passes a rejected token through as 400', async () => {
      upstream.respond.with = (_req, res) =>
        res.writeHead(400, { 'content-type': 'application/json' }).end('{"message":"Token is invalid or expired"}');
      const res = await t.http().post('/api/v1/contact-points/confirm').send({ token: 'expired' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Token is invalid or expired' });
    });
  });
});
