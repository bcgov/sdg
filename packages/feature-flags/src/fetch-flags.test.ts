import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchFlags } from './fetch-flags';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('fetchFlags', () => {
  it('Should GET /api/v1/shared/flags same-origin and return the evaluated flags', async () => {
    fetchMock.mockResolvedValue(Response.json({ hello_world: true, other: true }));
    await expect(fetchFlags()).resolves.toEqual({ hello_world: true, other: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/shared/flags');
    expect(init?.credentials).toBe('same-origin');
  });

  it('Should return an empty object when no flag is on', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await expect(fetchFlags()).resolves.toEqual({});
  });

  it.each([401, 503])('Should throw on %i and still read the body (R7)', async (status) => {
    const response = Response.json({ statusCode: status }, { status });
    fetchMock.mockResolvedValue(response);
    await expect(fetchFlags()).rejects.toThrow(`GET /api/v1/shared/flags failed with ${status}`);
    // An unread body leaves the request open in Chromium.
    expect(response.bodyUsed).toBe(true);
  });

  it('Should throw on a body that is not JSON (R7)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fetchFlags()).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([
    ['a non-boolean value', { x: 'yes' }],
    ['an array', [true]],
    ['null', null],
    ['a string', 'x'],
  ])('Should throw on %s (R7)', async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(fetchFlags()).rejects.toThrow('GET /api/v1/shared/flags returned an unexpected body');
  });
});
