import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type RemoteJWKSetOptions,
} from 'jose';

import { claimsToAuthUser } from './claims.js';
import { AuthError } from './errors.js';
import type { AuthFetch, AuthUser, JwtVerifier, JwtVerifierOptions } from './types.js';

/** Asymmetric algorithms only: `none` and HS* are never accepted. */
const ALGORITHMS: string[] = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

function discoveryUrl(issuerUrl: string): string {
  // A loop, not /\/+$/: that regex backtracks quadratically on a long run of '/' (CodeQL js/polynomial-redos).
  let end = issuerUrl.length;
  while (end > 0 && issuerUrl[end - 1] === '/') end--;
  return `${issuerUrl.slice(0, end)}/.well-known/openid-configuration`;
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

/** The issuer's keys could not be loaded (discovery or JWKS): no verdict on the token. */
class KeySetUnavailable extends Error {
  override readonly name = 'KeySetUnavailable';
}

/**
 * jose's JWKS fetch, failing with `KeySetUnavailable` on a network error, a timeout (jose's abort signal) or a non-200
 * answer, before jose turns the latter into a generic `JOSEError` indistinguishable from a token problem.
 */
function jwksFetch(fetchImpl: AuthFetch): AuthFetch {
  return async (url, init) => {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new KeySetUnavailable('JWKS request failed', { cause: error });
    }
    if (response.status !== 200) throw new KeySetUnavailable(`JWKS responded with HTTP ${response.status}`);
    return response;
  };
}

/**
 * The issuer's remote JWKS, discovered on first use; caches a successful discovery, retries after a failure. Fails
 * with `KeySetUnavailable` when discovery or the JWKS request fails.
 */
function lazyKeySet(options: JwtVerifierOptions): JWTVerifyGetKey {
  let cached: Promise<JWTVerifyGetKey> | undefined;
  const fetchImpl: AuthFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const jwksOptions: RemoteJWKSetOptions = { [customFetch]: jwksFetch(fetchImpl) };

  return async (protectedHeader, token) => {
    cached ??= fetchJwksUri(options.issuerUrl, fetchImpl)
      .then((uri) => createRemoteJWKSet(uri, jwksOptions))
      .catch((error: unknown) => {
        cached = undefined;
        throw new KeySetUnavailable('OpenID Provider discovery failed', { cause: error });
      });
    return (await cached)(protectedHeader, token);
  };
}

/** jose's `audience` option: the configured value(s), or none when a predicate decides after verification. */
function joseAudience(audience: JwtVerifierOptions['audience']): string | string[] | undefined {
  if (typeof audience === 'function') return undefined;
  return typeof audience === 'string' ? audience : [...audience];
}

/** Verifies bearer JWTs (signature via the issuer's JWKS, `iss`, `aud`, `exp`, `nbf`). */
export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const keySet = lazyKeySet(options);
  const audience = joseAudience(options.audience);
  const predicate = typeof options.audience === 'function' ? options.audience : undefined;
  const clockTolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;

  return {
    async verify(token: string): Promise<AuthUser> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keySet, {
          algorithms: ALGORITHMS,
          issuer: options.issuerUrl,
          audience,
          clockTolerance,
        }));
      } catch (error) {
        // Not being able to check the token (its issuer's keys are out of reach) is no verdict that it is invalid.
        const code = error instanceof KeySetUnavailable ? 'verifier_unavailable' : 'invalid_token';
        throw new AuthError(code, { cause: error });
      }
      // A predicate that throws (say, its lookup is down) rejects with its own error: that is no verdict on the token.
      if (predicate && !(await predicate(payload))) {
        throw new AuthError('invalid_token', { cause: new Error('audience not accepted') });
      }
      return claimsToAuthUser(payload);
    },
  };
}
