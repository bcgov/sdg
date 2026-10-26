/** The signed-in user as portal-api reports it (GET /api/auth/me). */
export interface CurrentUser {
  id: string;
  name: string;
  email: string | null;
}

export const AUTH_PATH = '/api/auth';

export type Navigate = (url: string) => void;

const assignLocation: Navigate = (url) => window.location.assign(url);

function isCurrentUser(value: unknown): value is CurrentUser {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('name' in value) || !('email' in value)) {
    return false;
  }
  const { id, name, email } = value;
  return typeof id === 'string' && typeof name === 'string' && (typeof email === 'string' || email === null);
}

/** `null` when signed out (401). Any other failure throws, so callers can tell "signed out" from "API down". */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch(`${AUTH_PATH}/me`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    // Read the unused body anyway: Chromium never finishes a request whose body is left unread, so the page
    // would never reach network idle.
    await response.text();
    if (response.status === 401) return null;
    throw new Error(`GET ${AUTH_PATH}/me failed with ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isCurrentUser(body)) throw new Error(`GET ${AUTH_PATH}/me returned an unexpected body`);
  return body;
}

/** BFF login URL: a full-page navigation that portal-api redirects to Keycloak and back to `returnTo`. */
export function loginHref(returnTo: string): string {
  return `${AUTH_PATH}/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Ends the BFF session, then hands the browser to Keycloak's logout (which returns to the app).
 * If the request fails the session may still exist server-side, but the app falls back to the home page.
 */
export async function logout(onSignedOut: () => void, navigate: Navigate = assignLocation): Promise<void> {
  let redirectUrl = '/';
  try {
    const response = await fetch(`${AUTH_PATH}/logout`, { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`POST ${AUTH_PATH}/logout failed with ${response.status}`);
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'redirectUrl' in body && typeof body.redirectUrl === 'string') {
      redirectUrl = body.redirectUrl;
    }
  } catch (error) {
    console.error('portal-web: logout request failed', error);
  }
  onSignedOut();
  navigate(redirectUrl);
}
