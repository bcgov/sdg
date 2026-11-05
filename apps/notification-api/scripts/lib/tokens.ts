// Access tokens for the local scripts: a user's (login.ts), a credential's (client credentials) or a fixed one.
// Tokens are only ever sent as bearer headers; nothing here logs or prints them.
import * as client from 'openid-client';
import { z } from 'zod';

/** Hands out a current access token, refreshing or re-fetching it shortly before it expires. */
export interface TokenSource {
  token(): Promise<string>;
}

/** Fetch a new token this long before the current one expires. */
const EXPIRY_MARGIN_MS = 30_000;

type TokenResponse = client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;

/** Discovery for a client: client_secret_post when it has a secret, none for a public client. */
export function discover(issuerUrl: string, clientId: string, clientSecret?: string): Promise<client.Configuration> {
  const auth = clientSecret === undefined ? client.None() : client.ClientSecretPost(clientSecret);
  return client.discovery(new URL(issuerUrl), clientId, undefined, auth);
}

const expiresAt = (response: TokenResponse): number => {
  const seconds = response.expiresIn();
  return seconds === undefined ? Number.POSITIVE_INFINITY : Date.now() + seconds * 1000;
};

/** A token that is used as given, e.g. NOTIFICATION_ADMIN_TOKEN from `pnpm login`. */
export function staticToken(token: string): TokenSource {
  return { token: () => Promise.resolve(token) };
}

/** Re-runs `fetchToken` whenever the cached token is about to expire. */
function cachedToken(fetchToken: (current: TokenResponse | undefined) => Promise<TokenResponse>): TokenSource {
  let current: { response: TokenResponse; expiresAt: number } | undefined;
  return {
    async token() {
      if (current === undefined || current.expiresAt - Date.now() < EXPIRY_MARGIN_MS) {
        const response = await fetchToken(current?.response);
        current = { response, expiresAt: expiresAt(response) };
      }
      return current.response.access_token;
    },
  };
}

/** A user's tokens from an authorization code grant, renewed with the refresh token when there is one. */
export function refreshingToken(config: client.Configuration, initial: TokenResponse): TokenSource {
  return cachedToken(async (current) => {
    if (current === undefined) return initial;
    if (current.refresh_token === undefined) {
      throw new Error('The admin token expired and there is no refresh token: run the script again');
    }
    return client.refreshTokenGrant(config, current.refresh_token);
  });
}

/** A Keycloak service-account client's tokens (a sender credential), fetched by client credentials. */
export async function clientCredentialsToken(
  issuerUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenSource> {
  const config = await discover(issuerUrl, clientId, clientSecret);
  const source = cachedToken(() => client.clientCredentialsGrant(config));
  // Fetch once now, so a wrong client id or secret fails before anything else runs.
  await source.token();
  return source;
}

const claimsSchema = z.object({ iss: z.string().min(1), sub: z.string().min(1) });

/** The person a user token names, as notification-api identifies people (issuer + subject). Not verified. */
export function personOf(token: string): { issuer: string; subject: string } {
  const payload = token.split('.')[1];
  if (payload === undefined) throw new Error('The admin token is not a JWT');
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  return { issuer: claims.iss, subject: claims.sub };
}
