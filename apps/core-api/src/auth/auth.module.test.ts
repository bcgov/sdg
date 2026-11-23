import type { AuthFetch } from '@repo/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTH_FETCH, AuthModule } from './auth.module.js';

describe('AuthModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Should delegate AUTH_FETCH to global fetch', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- NestJS @Module stores provider definitions in metadata
    const providers = Reflect.getMetadata('providers', AuthModule) as { provide: unknown; useValue?: AuthFetch }[];
    const authFetch = providers.find((provider) => provider.provide === AUTH_FETCH)?.useValue;
    expect(authFetch).toBeTypeOf('function');

    const init: RequestInit = { method: 'GET' };
    const result = await authFetch?.('https://idp.test/.well-known/openid-configuration', init);

    expect(fetchSpy).toHaveBeenCalledWith('https://idp.test/.well-known/openid-configuration', init);
    expect(result).toBe(response);
  });
});
