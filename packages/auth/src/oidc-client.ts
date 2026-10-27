import * as client from 'openid-client';

import { claimsToAuthUser } from './claims.js';
import { AuthError } from './errors.js';
import type {
  AuthorizationRequest,
  CallbackResult,
  OidcClient,
  OidcClientOptions,
  OidcTokens,
  PendingAuthorization,
} from './types.js';

const DEFAULT_SCOPES: readonly string[] = ['openid', 'profile', 'email'];

type Discover = () => Promise<client.Configuration>;

/** Lazy discovery: a successful result is cached, a failure is not (the next call retries). */
function lazyDiscovery(options: OidcClientOptions): Discover {
  let cached: Promise<client.Configuration> | undefined;
  const discoveryOptions: client.DiscoveryRequestOptions = {};
  if (options.fetch) discoveryOptions[client.customFetch] = options.fetch;

  return () => {
    cached ??= client
      .discovery(
        new URL(options.issuerUrl),
        options.clientId,
        undefined,
        client.ClientSecretPost(options.clientSecret),
        discoveryOptions,
      )
      .catch((error: unknown) => {
        cached = undefined;
        throw new AuthError('discovery_failed', { cause: error });
      });
    return cached;
  };
}

function toTokens(response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers): OidcTokens {
  if (response.id_token === undefined) {
    throw new AuthError('callback_failed', { detail: 'token response has no id_token' });
  }
  const expiresIn = response.expiresIn();
  return {
    idToken: response.id_token,
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    expiresAt: expiresIn === undefined ? null : Date.now() + expiresIn * 1000,
  };
}

function toCallbackError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof client.AuthorizationResponseError) {
    return new AuthError('callback_failed', { detail: error.error, cause: error });
  }
  const detail = error instanceof client.ClientError ? error.code : undefined;
  return new AuthError('callback_failed', { detail, cause: error });
}

async function exchangeCode(
  config: client.Configuration,
  callbackUrl: URL,
  pending: PendingAuthorization,
): Promise<CallbackResult> {
  const response = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  });
  const tokens = toTokens(response);
  const claims = response.claims();
  if (claims === undefined) throw new AuthError('callback_failed', { detail: 'missing id_token claims' });
  return { user: claimsToAuthUser(claims), tokens };
}

/**
 * OIDC relying-party client (authorization code + PKCE S256) for Keycloak.
 * Discovery runs lazily, so creating the client never touches the network.
 */
export function createOidcClient(options: OidcClientOptions): OidcClient {
  const discover = lazyDiscovery(options);
  const scope = (options.scopes ?? DEFAULT_SCOPES).join(' ');

  return {
    async discover(): Promise<void> {
      await discover();
    },

    async createAuthorizationRequest(returnTo: string): Promise<AuthorizationRequest> {
      const config = await discover();
      const pending: PendingAuthorization = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        codeVerifier: client.randomPKCECodeVerifier(),
        returnTo,
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: options.redirectUri,
        response_type: 'code',
        scope,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(pending.codeVerifier),
        code_challenge_method: 'S256',
      });
      return { url, pending };
    },

    async handleCallback(callbackUrl: URL, pending: PendingAuthorization): Promise<CallbackResult> {
      const state = callbackUrl.searchParams.get('state');
      if (state === null || pending.state === '' || state !== pending.state) {
        throw new AuthError('invalid_state');
      }
      const config = await discover();
      try {
        return await exchangeCode(config, callbackUrl, pending);
      } catch (error) {
        throw toCallbackError(error);
      }
    },

    async buildEndSessionUrl(idToken: string | null): Promise<URL> {
      const config = await discover();
      const parameters: Record<string, string> = {
        client_id: options.clientId,
        post_logout_redirect_uri: options.postLogoutRedirectUri,
      };
      if (idToken) parameters['id_token_hint'] = idToken;
      return client.buildEndSessionUrl(config, parameters);
    },
  };
}
