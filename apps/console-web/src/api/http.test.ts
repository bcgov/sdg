import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiErrorKind, apiRequest, ORIGIN_REFUSAL_MESSAGE } from './http';

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
  const error: unknown = await apiRequest('/api/v1/console/service-clients').catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(error)}`);
  return error;
}

describe('apiRequest', () => {
  describe('requests', () => {
    it('sends same-origin GETs that accept JSON and resolves the parsed body', async () => {
      fetchMock.mockResolvedValue(Response.json([{ clientId: 'a' }]));
      await expect(apiRequest('/api/v1/console/service-clients')).resolves.toEqual([{ clientId: 'a' }]);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/v1/console/service-clients');
      expect(init).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      expect(init?.body).toBeUndefined();
    });

    it('sends a JSON body with its content type', async () => {
      fetchMock.mockResolvedValue(Response.json({ clientId: 'a' }, { status: 201 }));
      await apiRequest('/api/v1/console/service-clients', {
        method: 'POST',
        body: { clientId: 'a', displayName: 'A' },
      });
      const [, init] = fetchMock.mock.calls[0]!;
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
      expect(init?.body).toBe('{"clientId":"a","displayName":"A"}');
    });

    it('resolves undefined for a 204 and reads every body', async () => {
      const response = new Response(null, { status: 204 });
      fetchMock.mockResolvedValue(response);
      await expect(apiRequest('/x', { method: 'DELETE' })).resolves.toBeUndefined();
      const refused = Response.json({ statusCode: 503 }, { status: 503 });
      fetchMock.mockResolvedValue(refused);
      await expect(apiRequest('/x')).rejects.toBeInstanceOf(ApiError);
      // An unread body leaves the request open in Chromium.
      expect(refused.bodyUsed).toBe(true);
    });
  });

  describe('refusals (R32)', () => {
    it('reads 401 as the session ending', async () => {
      expect((await failure(Response.json({ statusCode: 401, message: 'Unauthorized' }, { status: 401 }))).kind).toBe(
        'session-ended',
      );
    });

    it.each([502, 503, 504])('reads %i as unavailable', async (status) => {
      expect((await failure(new Response('down', { status }))).kind).toBe('unavailable');
    });

    it('reads a network failure as unavailable and keeps the cause', async () => {
      const cause = new TypeError('Failed to fetch');
      const error = await failure(cause);
      expect(error.kind).toBe('unavailable');
      expect(error.status).toBeUndefined();
      expect(error.cause).toBe(cause);
    });

    it("reads core-api's 403 as not authorized", async () => {
      const refusal = Response.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 });
      expect((await failure(refusal)).kind).toBe('not-authorized');
    });

    it("reads the origin guard's 403 as blocked, not as a missing role", async () => {
      const refusal = Response.json(
        { statusCode: 403, message: ORIGIN_REFUSAL_MESSAGE, error: 'Forbidden' },
        { status: 403 },
      );
      expect(ORIGIN_REFUSAL_MESSAGE).toBe('Cross-origin request refused');
      expect((await failure(refusal)).kind).toBe('blocked');
    });

    it('reads a 403 without a Nest body (the edge WAF) as blocked', async () => {
      expect((await failure(new Response('<html>403 Forbidden</html>', { status: 403 }))).kind).toBe('blocked');
    });

    it("keeps a 400's validation issues as reasons", async () => {
      const error = await failure(
        Response.json(
          { statusCode: 400, message: ['clientId: Must be a Keycloak client id'], error: 'Bad Request' },
          { status: 400 },
        ),
      );
      expect(error.kind).toBe('invalid');
      expect(error.reasons).toEqual(['clientId: Must be a Keycloak client id']);
    });

    it.each([
      [404, 'not-found'],
      [409, 'conflict'],
      [500, 'unexpected'],
    ])('reads %i as %s with the message as its reason', async (status, kind) => {
      const error = await failure(Response.json({ statusCode: status, message: 'why' }, { status }));
      expect(error).toMatchObject({ kind, status, reasons: ['why'] });
    });
  });

  it('apiErrorKind reads anything other than an ApiError as unexpected', () => {
    expect(apiErrorKind(new ApiError('conflict', 409))).toBe('conflict');
    expect(apiErrorKind(new Error('boom'))).toBe('unexpected');
  });
});
