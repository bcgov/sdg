import { AuthError, type OidcTokens } from '@repo/auth';
import { principals } from '@repo/portal-database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp, resetOidcStub, type TestApp } from '../testing/app.js';
import { json, signIn, startUpstream, tokens, type Upstream } from '../testing/notification-upstream.js';

function expiringSoon(): OidcTokens {
  return tokens({ expiresAt: Date.now() + 10_000 });
}

describe('notification relay token refresh', () => {
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

  it('refreshes a token expiring in 10 seconds before relaying and saves the new tokens', async () => {
    const agent = await signIn(t, expiringSoon());
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
    const agent = await signIn(t, tokens({ expiresAt: Date.now() + 60_000 }));
    await agent.get('/api/v1/notifications/contact-points');
    expect(t.oidc.refresh).not.toHaveBeenCalled();
    expect(upstream.received[0]?.authorization).toBe('Bearer access-token');
  });

  it('refreshes once for two concurrent requests', async () => {
    const agent = await signIn(t, expiringSoon());
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

  it.each([
    ['the IdP rejects the refresh token', new AuthError('refresh_failed', { detail: 'invalid_grant' })],
    ['the session has no refresh token', new AuthError('refresh_failed', { detail: 'no refresh token' })],
  ])('returns 401 and destroys the session when %s', async (_case, error) => {
    const agent = await signIn(t, expiringSoon());
    t.oidc.refresh.mockRejectedValue(error);
    expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(401);
    expect(upstream.received).toEqual([]);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it.each([
    ['the IdP is unreachable', new AuthError('refresh_failed', { cause: new TypeError('fetch failed') })],
    // What openid-client reports for a 5xx without an OAuth error body.
    ['the IdP answers 5xx', new AuthError('refresh_failed', { detail: 'OAUTH_RESPONSE_IS_NOT_CONFORM' })],
    ['discovery fails', new AuthError('discovery_failed', { cause: new TypeError('fetch failed') })],
  ])('returns 502 and keeps the session when %s, and retries on the next call', async (_case, error) => {
    const agent = await signIn(t, expiringSoon());
    t.oidc.refresh.mockRejectedValueOnce(error);
    expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(502);
    expect(upstream.received).toEqual([]);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    // The IdP is back: the next relayed call refreshes again with the same session and goes through.
    expect((await agent.get('/api/v1/notifications/contact-points')).status).toBe(200);
    expect(t.oidc.refresh).toHaveBeenCalledTimes(2);
    expect(upstream.received.map(({ authorization }) => authorization)).toEqual(['Bearer refreshed-access-token']);
  });
});
