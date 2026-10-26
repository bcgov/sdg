import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey, type RemoteJWKSetOptions } from 'jose';

import { claimsToAuthUser } from './claims.js';
import { AuthError } from './errors.js';
import type { AuthFetch, AuthUser, JwtVerifier, JwtVerifierOptions } from './types.js';

/** Asymmetric algorithms only: `none` and HS* are never accepted. */
const ALGORITHMS: string[] = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

function discoveryUrl(issuerUrl: string): string {
  return `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

async function fetchJwksUri(issuerUrl: string, fetchImpl: AuthFetch): Promise<URL> {
  const response = await fetchImpl(discoveryUrl(issuerUrl), {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'manual',
  });
  if (!response.ok) throw new Error(`discovery responded with HTTP ${response.status}`);
  const metadata: unknown = await response.json();
  if (typeof metadata !== 'object' || metadata === null || !('jwks_uri' in metadata)) {
    throw new Error('discovery document has no jwks_uri');
  }
  const { jwks_uri: jwksUri } = metadata;
  if (typeof jwksUri !== 'string') throw new Error('discovery jwks_uri is not a string');
  return new URL(jwksUri);
}

/** Resolves the issuer's remote JWKS lazily; caches success, retries after a failure. */
function lazyKeySet(options: JwtVerifierOptions): () => Promise<JWTVerifyGetKey> {
  let cached: Promise<JWTVerifyGetKey> | undefined;
  const fetchImpl: AuthFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const jwksOptions: RemoteJWKSetOptions = {};
  if (options.fetch) jwksOptions[customFetch] = options.fetch;

  return () => {
    cached ??= fetchJwksUri(options.issuerUrl, fetchImpl)
      .then((uri) => createRemoteJWKSet(uri, jwksOptions))
      .catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    return cached;
  };
}

/** Verifies bearer JWTs (signature via the issuer's JWKS, `iss`, `aud`, `exp`, `nbf`). */
export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const keySet = lazyKeySet(options);
  const audience = typeof options.audience === 'string' ? options.audience : [...options.audience];
  const clockTolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;

  return {
    async verify(token: string): Promise<AuthUser> {
      try {
        const { payload } = await jwtVerify(token, await keySet(), {
          algorithms: ALGORITHMS,
          issuer: options.issuerUrl,
          audience,
          clockTolerance,
        });
        return claimsToAuthUser(payload);
      } catch (error) {
        throw new AuthError('invalid_token', { cause: error });
      }
    },
  };
}
