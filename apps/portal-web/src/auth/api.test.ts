import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCurrentUser, loginHref, logout } from './api';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('auth api', () => {
  describe('fetchCurrentUser', () => {
    it('returns the user on 200', async () => {
      fetchMock.mockResolvedValue(Response.json({ id: 'p-1', name: 'Ada Lovelace', email: null }));
      await expect(fetchCurrentUser()).resolves.toEqual({ id: 'p-1', name: 'Ada Lovelace', email: null });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/auth/me');
      expect(init?.credentials).toBe('same-origin');
    });

    it('returns null on 401', async () => {
      fetchMock.mockResolvedValue(Response.json({ statusCode: 401 }, { status: 401 }));
      await expect(fetchCurrentUser()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws on other statuses', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }));
      await expect(fetchCurrentUser()).rejects.toThrow('GET /api/auth/me failed with 502');
      fetchMock.mockResolvedValueOnce(Response.json({ id: 1 }));
      await expect(fetchCurrentUser()).rejects.toThrow('unexpected body');
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(fetchCurrentUser()).rejects.toThrow('Failed to fetch');
    });
  });

  describe('loginHref', () => {
    it('points at /api/auth/login with the encoded returnTo', () => {
      expect(loginHref('/reports?year=2026&q=a b#top')).toBe(
        '/api/auth/login?returnTo=%2Freports%3Fyear%3D2026%26q%3Da%20b%23top',
      );
      expect(loginHref('/')).toBe('/api/auth/login?returnTo=%2F');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('posts to /api/auth/logout and navigates to redirectUrl', async () => {
      const redirectUrl = 'https://keycloak.example.com/realms/portal/protocol/openid-connect/logout?client_id=portal';
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

    it('navigates to / when the request fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
      const onSignedOut = vi.fn<() => void>();
      const navigate = vi.fn<(url: string) => void>();
      await logout(onSignedOut, navigate);
      expect(onSignedOut).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/');
      expect(consoleError).toHaveBeenCalledWith('portal-web: logout request failed', expect.any(Error));
    });
  });
});
