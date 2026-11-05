import { principals } from '@repo/portal-database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { json, signIn, startUpstream, type Upstream } from '../testing/notification-upstream.js';

describe('notification relay', () => {
  let t: TestApp;
  let upstream: Upstream;

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

  describe('recipient routes', () => {
    it('forwards to /api/v1/me with the session access token and returns the upstream response', async () => {
      const agent = await signIn(t);
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
      const agent = await signIn(t);
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
      const agent = await signIn(t);
      upstream.respond.with = (req) => req.socket.destroy();
      const res = await agent.get('/api/v1/notifications/contact-points');
      expect(res.status).toBe(502);
    });

    it('never relays outside /api/v1/me', async () => {
      const agent = await signIn(t);
      expect((await agent.get('/api/v1/notifications/%2e%2e/admin/senders')).status).toBe(404);
      expect(upstream.received).toEqual([]);
    });

    it('rejects a request without a session and does not call notification-api', async () => {
      const res = await t.http().get('/api/v1/notifications/contact-points');
      expect(res.status).toBe(401);
      expect(upstream.received).toEqual([]);
    });
  });

  describe('cross-site request protection', () => {
    const attackerFields = 'channel=email&address=attacker@evil.test';

    it.each([
      ['application/x-www-form-urlencoded', attackerFields],
      ['text/plain', attackerFields],
      [
        'multipart/form-data; boundary=x',
        `--x\r\ncontent-disposition: form-data; name="channel"\r\n\r\nemail\r\n--x--`,
      ],
    ])('returns 415 for a %s POST and does not call notification-api', async (type, body) => {
      const agent = await signIn(t);
      const res = await agent.post('/api/v1/notifications/contact-points').set('content-type', type).send(body);
      expect(res.status).toBe(415);
      expect(upstream.received).toEqual([]);
    });

    it.each(['cross-site', 'same-site'])(
      'returns 403 for a JSON POST with Sec-Fetch-Site: %s and does not call notification-api',
      async (site) => {
        const agent = await signIn(t);
        const res = await agent
          .post('/api/v1/notifications/contact-points')
          .set('sec-fetch-site', site)
          .send({ channel: 'email', address: 'attacker@evil.test' });
        expect(res.status).toBe(403);
        expect(upstream.received).toEqual([]);
      },
    );

    it('relays same-origin JSON and body-less mutations', async () => {
      const agent = await signIn(t);
      upstream.respond.with = (_req, res) => res.writeHead(204).end();
      const post = await agent
        .post('/api/v1/notifications/contact-points')
        .set('sec-fetch-site', 'same-origin')
        .send({ channel: 'email', address: 'ada@example.com' });
      expect(post.status).toBe(204);
      expect((await agent.post('/api/v1/notifications/contact-points/cp-1/resend')).status).toBe(204);
      expect((await agent.delete('/api/v1/notifications/contact-points/cp-1')).status).toBe(204);
      expect(upstream.received.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
        {
          method: 'POST',
          url: '/api/v1/me/contact-points',
          body: '{"channel":"email","address":"ada@example.com"}',
        },
        { method: 'POST', url: '/api/v1/me/contact-points/cp-1/resend', body: '' },
        { method: 'DELETE', url: '/api/v1/me/contact-points/cp-1', body: '' },
      ]);
    });

    it('applies the same checks to the public confirm route', async () => {
      const form = await t.http().post('/api/v1/contact-points/confirm').type('form').send('token=link-token');
      expect(form.status).toBe(415);
      const crossSite = await t
        .http()
        .post('/api/v1/contact-points/confirm')
        .set('sec-fetch-site', 'cross-site')
        .send({ token: 'link-token' });
      expect(crossSite.status).toBe(403);
      expect(upstream.received).toEqual([]);
    });
  });

  describe('POST /api/v1/contact-points/confirm', () => {
    it('forwards the token without a session or bearer token', async () => {
      upstream.respond.with = (_req, res) => res.writeHead(204).end();
      const res = await t
        .http()
        .post('/api/v1/contact-points/confirm')
        .set('sec-fetch-site', 'same-origin')
        .send({ token: 'link-token' });
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
