import { apiRequest } from '../api/http';

export const KEEP_ALIVE_PATH = '/api/auth/keep-alive';

/**
 * Renews the session (portal-api refreshes its tokens, restarting Keycloak's idle limit) and resolves when it will
 * lapse next, as epoch milliseconds, or `null` when portal-api can't say. Rejects with an `ApiError`: a 401 means the
 * session has already ended.
 */
export async function postKeepAlive(): Promise<number | null> {
  const body = await apiRequest(KEEP_ALIVE_PATH, { method: 'POST' });
  if (typeof body !== 'object' || body === null || !('idleExpiresAt' in body)) {
    throw new Error(`POST ${KEEP_ALIVE_PATH} returned an unexpected body`);
  }
  const { idleExpiresAt } = body;
  if (idleExpiresAt !== null && typeof idleExpiresAt !== 'number') {
    throw new Error(`POST ${KEEP_ALIVE_PATH} returned an unexpected body`);
  }
  return idleExpiresAt;
}
