import { describe, expect, it } from 'vitest';

import { fakeConsoleApi, nestError, serviceClient } from './fake-console-api';

const BASE = '/api/v1/console/service-clients';

describe('FakeConsoleApi', () => {
  it('Should accept string, URL, and Request inputs in fetch (line 31)', async () => {
    const api = fakeConsoleApi({ clients: [serviceClient('partner-a')] });

    expect((await fetch(BASE)).status).toBe(200);
    expect((await fetch(new URL(`https://console.example.test${BASE}`))).status).toBe(200);
    expect((await fetch(new Request(`https://console.example.test${BASE}`))).status).toBe(200);

    expect(api.callsTo('GET', BASE)).toHaveLength(3);
  });

  it('Should answer 404 for unmatched paths and unsupported client route methods (line 134)', async () => {
    fakeConsoleApi({ clients: [serviceClient('partner-a')] });

    expect((await fetch('/api/v1/unknown')).status).toBe(404);
    expect((await fetch(`${BASE}/missing`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${BASE}/partner-a`, { method: 'GET' })).status).toBe(404);
    expect((await fetch(`${BASE}/partner-a/enable`, { method: 'DELETE' })).status).toBe(404);
  });

  it('Should handle auth, refusals, shared flags, registry CRUD, and history', async () => {
    const api = fakeConsoleApi({
      clients: [serviceClient('zulu'), serviceClient('alpha')],
      flags: { hello_world: true },
    });

    // nestError with and without error
    expect(nestError(400, 'Bad').status).toBe(400);

    // /api/auth/me signed in, /api/auth/logout, signed out 401
    expect((await fetch('/api/auth/me')).status).toBe(200);
    expect((await fetch('/api/auth/logout', { method: 'POST' })).status).toBe(200);
    expect((await fetch('/api/auth/me')).status).toBe(401);
    expect((await fetch(BASE)).status).toBe(401);
    api.signedIn = true;

    // refusals (string and RegExp)
    api.refuseNext('GET', BASE, () => new Response(null, { status: 503 }));
    expect((await fetch(BASE)).status).toBe(503);
    api.refuseNext('GET', /^\/api\/v1\/shared\//, () => new Response(null, { status: 503 }));
    expect((await fetch('/api/v1/shared/flags')).status).toBe(503);

    // shared routes
    expect((await fetch('/api/v1/shared/flags')).status).toBe(200);
    expect((await fetch('/api/v1/shared/flags', { method: 'POST' })).status).toBe(404);
    expect((await fetch('/api/v1/shared/hello-world')).status).toBe(200);
    api.flags = {};
    expect((await fetch('/api/v1/shared/hello-world')).status).toBe(404);

    // add: conflict (line 149), non-object body, and sorting in both directions
    expect(
      (
        await fetch(BASE, {
          method: 'POST',
          body: JSON.stringify({ clientId: 'zulu', displayName: 'Zulu' }),
        })
      ).status,
    ).toBe(409);
    expect((await fetch(BASE, { method: 'POST', body: 'null' })).status).toBe(201);
    expect(
      (
        await fetch(BASE, {
          method: 'POST',
          body: JSON.stringify({ clientId: 'mike', displayName: 'Mike' }),
        })
      ).status,
    ).toBe(201);

    // setEnabled: disable, repeat disable (no-op), enable
    expect((await fetch(`${BASE}/alpha/disable`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${BASE}/alpha/disable`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${BASE}/alpha/enable`, { method: 'POST' })).status).toBe(200);

    // remove
    expect((await fetch(`${BASE}/mike`, { method: 'DELETE' })).status).toBe(204);

    // history: default and paged with limit & before
    const firstPage = await (await fetch(`${BASE}/history?limit=2`)).json();
    expect(firstPage.events).toHaveLength(2);
    expect(firstPage.nextBefore).not.toBeNull();

    const fullPage = await (await fetch(`${BASE}/history?before=${firstPage.nextBefore}`)).json();
    expect(fullPage.nextBefore).toBeNull();
  });
});
