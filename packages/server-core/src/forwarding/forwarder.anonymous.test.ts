import { describe, expect, it, vi } from 'vitest';

import { Forwarder, type ForwarderLogger, type TokenResult } from './forwarder.js';

/** A Forwarder whose fetch answers 200 and records what it was called with. */
function forwarderWith(token: TokenResult) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }));
  const forwarder = new Forwarder<undefined>({
    upstream: 'http://core-api.test',
    audiences: ['shared'],
    token: async () => token,
    logger: { warn: vi.fn<ForwarderLogger['warn']>() },
    fetch,
  });
  const sentHeaders = () => fetch.mock.calls.map(([, init]) => new Headers(init?.headers));
  return { forwarder, fetch, sentHeaders };
}

const incoming = { accept: 'application/json', authorization: 'Bearer browser-token', cookie: 'portal.sid=secret' };

describe('Forwarder with an anonymous token result (KTD2)', () => {
  it('forwards with no Authorization, dropping the browser one, and relays the answer', async () => {
    const { forwarder, fetch, sentHeaders } = forwarderWith({ anonymous: true });
    const result = await forwarder.forward(
      { method: 'GET', url: '/api/v1/shared/flags', headers: incoming },
      undefined,
    );
    expect(result).toMatchObject({ kind: 'response', status: 200 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://core-api.test/api/v1/shared/flags', expect.anything());
    const [headers] = sentHeaders();
    expect(headers?.get('accept')).toBe('application/json');
    expect(headers?.has('authorization')).toBe(false);
    expect(headers?.has('cookie')).toBe(false);
  });

  it('still sends the Bearer token when the result carries one', async () => {
    const { forwarder, sentHeaders } = forwarderWith({ token: 'access-token' });
    await forwarder.forward({ method: 'GET', url: '/api/v1/shared/flags', headers: incoming }, undefined);
    expect(sentHeaders().map((headers) => headers.get('authorization'))).toEqual(['Bearer access-token']);
  });
});
