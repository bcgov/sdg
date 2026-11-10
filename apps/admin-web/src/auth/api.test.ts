import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCurrentUser, loginHref, logout } from './api';

const fetchMock = vi.fn<typeof fetch>();
const originalLocation = window.location;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('Auth API Integration Test Suite', () => {
  describe('fetchCurrentUser', () => {
    it('Should return the user on 200', async () => {
      fetchMock.mockResolvedValue(Response.json({ id: 'p-1', name: 'Ada Lovelace', email: null }));
      await expect(fetchCurrentUser()).resolves.toEqual({ id: 'p-1', name: 'Ada Lovelace', email: null });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/auth/me');
      expect(init?.credentials).toBe('same-origin');
    });

    it('Should return the user with a string email on 200', async () => {
      fetchMock.mockResolvedValue(
        Response.json({
          id: 'p-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        }),
      );
      await expect(fetchCurrentUser()).resolves.toEqual({
        id: 'p-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
    });

    it('Should return null on 401', async () => {
      const response = Response.json({ statusCode: 401 }, { status: 401 });
      fetchMock.mockResolvedValue(response);
      await expect(fetchCurrentUser()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // An unread body leaves the request open in Chromium.
      expect(response.bodyUsed).toBe(true);
    });
  });

  describe('loginHref', () => {
    it('Should point at /api/auth/login with the encoded returnTo', () => {
      expect(loginHref('/reports?year=2026&q=a b#top')).toBe(
        '/api/auth/login?returnTo=%2Freports%3Fyear%3D2026%26q%3Da%20b%23top',
      );
      expect(loginHref('/')).toBe('/api/auth/login?returnTo=%2F');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('Should post to /api/auth/logout and navigates to redirectUrl', async () => {
      const redirectUrl =
        'https://keycloak.example.com/realms/portal/protocol/openid-connect/logout?client_id=sdg-admin';
      fetchMock.mockResolvedValue(Response.json({ redirectUrl }));
      const onSignedOut = vi.fn<() => void>();
      const navigate = vi.fn<(url: string) => void>();
      await logout(onSignedOut, navigate);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/auth/logout');
      expect(init?.method).toBe('POST');
      expect(onSignedOut).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(redirectUrl);
      expect(onSignedOut.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
    });

    it('Should navigate to / when the request fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
      const onSignedOut = vi.fn<() => void>();
      const navigate = vi.fn<(url: string) => void>();
      await logout(onSignedOut, navigate);
      expect(onSignedOut).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(consoleError).toHaveBeenCalledWith('admin-web: logout request failed', expect.any(Error));
    });

    it('Should fall back to / when response body has invalid or missing redirectUrl', async () => {
      const invalidBodies = [{}, { redirectUrl: 123 }, { redirectUrl: null }, null, 'not-an-object'];
      const onSignedOut = vi.fn<() => void>();
      const navigate = vi.fn<(url: string) => void>();

      fetchMock.mockResolvedValueOnce(Response.json(invalidBodies[0]));
      await logout(onSignedOut, navigate);
      fetchMock.mockResolvedValueOnce(Response.json(invalidBodies[1]));
      await logout(onSignedOut, navigate);
      fetchMock.mockResolvedValueOnce(Response.json(invalidBodies[2]));
      await logout(onSignedOut, navigate);
      fetchMock.mockResolvedValueOnce(Response.json(invalidBodies[3]));
      await logout(onSignedOut, navigate);
      fetchMock.mockResolvedValueOnce(Response.json(invalidBodies[4]));
      await logout(onSignedOut, navigate);

      expect(onSignedOut).toHaveBeenCalledTimes(5);
      expect(navigate).toHaveBeenCalledWith('/');
    });

    it('Should use assignLocation default parameter when navigate argument is omitted', async () => {
      const assignMock = vi.fn<(url: string) => void>();
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { assign: assignMock },
      });
      const redirectUrl = 'https://keycloak.example.com/logout';
      fetchMock.mockResolvedValue(Response.json({ redirectUrl }));
      const onSignedOut = vi.fn<() => void>();

      await logout(onSignedOut);

      expect(onSignedOut).toHaveBeenCalledTimes(1);
      expect(assignMock).toHaveBeenCalledWith(redirectUrl);
    });
  });
});
