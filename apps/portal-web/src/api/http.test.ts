import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest } from './http';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
});

async function failure(response: Response | Error): Promise<ApiError> {
  if (response instanceof Error) fetchMock.mockRejectedValue(response);
  else fetchMock.mockResolvedValue(response);
  const error: unknown = await apiRequest('/api/v1/portal/profile').catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(error)}`);
  return error;
}

describe('apiRequest', () => {
  it('sends a same-origin GET that accepts JSON and resolves the parsed body', async () => {
    fetchMock.mockResolvedValue(Response.json({ name: 'Ada' }));
    await expect(apiRequest('/api/v1/portal/profile')).resolves.toEqual({ name: 'Ada' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/portal/profile', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  });

  it('sends a POST when asked', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiRequest('/api/auth/keep-alive', { method: 'POST' })).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('resolves a body that is not JSON as its text, for the caller to reject', async () => {
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }));
    await expect(apiRequest('/api/v1/portal/profile')).resolves.toBe('<html>gateway</html>');
  });

  it.each([
    [401, 'session-ended'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [403, 'unexpected'],
    [500, 'unexpected'],
  ] as const)('reads a %i as %s', async (status, kind) => {
    const error = await failure(Response.json({ statusCode: status }, { status }));
    expect(error).toMatchObject({ kind, status });
  });

  it('reads no answer at all as unavailable, keeping the cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const error = await failure(cause);
    expect(error).toMatchObject({ kind: 'unavailable', status: undefined, cause });
  });

  it('reads the body of a refusal, so Chromium finishes the request', async () => {
    const response = Response.json({ statusCode: 401 }, { status: 401 });
    await failure(response);
    expect(response.bodyUsed).toBe(true);
  });
});
