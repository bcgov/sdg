import { claimsToAuthUser, type AuthFetch, type AuthUser } from '@repo/auth';
import { z } from 'zod';

/** Each userinfo or discovery request gives up after this long. */
export const USERINFO_TIMEOUT_MS = 5000;

/**
 * Why the profile could not be read: Keycloak unreachable or failing (`unavailable`, 503), Keycloak refusing the
 * token (`rejected`, 401), or an answer that is not about the token's subject (`invalid`).
 */
export type UserinfoFailure = 'unavailable' | 'rejected' | 'invalid';

export class UserinfoError extends Error {
  readonly reason: UserinfoFailure;

  constructor(reason: UserinfoFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UserinfoError';
    this.reason = reason;
  }
}

const discoverySchema = z.object({ userinfo_endpoint: z.url() });
const userinfoSchema = z.looseObject({ sub: z.string().min(1) });

async function request(fetchImpl: AuthFetch, url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
  } catch (error) {
    throw new UserinfoError('unavailable', `Request to ${new URL(url).pathname} failed`, { cause: error });
  }
}

async function jsonBody<T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  if (!response.ok) throw new UserinfoError('unavailable', `${what} responded with HTTP ${response.status}`);
  try {
    return schema.parse(await response.json());
  } catch (error) {
    throw new UserinfoError('unavailable', `${what} returned an unexpected body`, { cause: error });
  }
}

/**
 * Reads the caller's profile from Keycloak's userinfo endpoint with the caller's own access token, so the
 * principal gets its real name and email whether or not the realm maps profile claims into access tokens.
 * The endpoint comes from the issuer's discovery document, fetched on first use and again after a failure.
 */
export class UserinfoClient {
  private readonly discoveryUrl: string;
  private readonly fetchImpl: AuthFetch;
  private endpoint: Promise<string> | undefined;

  constructor(issuerUrl: string, fetchImpl: AuthFetch) {
    this.discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
    this.fetchImpl = fetchImpl;
  }

  /** `verified`'s issuer and subject with the profile userinfo returns for `accessToken`. */
  async profile(accessToken: string, verified: AuthUser): Promise<AuthUser> {
    const response = await request(this.fetchImpl, await this.userinfoEndpoint(), {
      authorization: `Bearer ${accessToken}`,
    });
    if (response.status === 401 || response.status === 403) {
      throw new UserinfoError('rejected', `userinfo refused the token with HTTP ${response.status}`);
    }
    const claims = await jsonBody(response, userinfoSchema, 'userinfo');
    // OIDC Core 5.3.2: the answer must be about the token's subject, or it is not to be used.
    if (claims.sub !== verified.subject) throw new UserinfoError('invalid', 'userinfo answered for another subject');
    return claimsToAuthUser({ ...claims, iss: verified.issuer, sub: verified.subject });
  }

  private userinfoEndpoint(): Promise<string> {
    this.endpoint ??= this.discover().catch((error: unknown) => {
      this.endpoint = undefined;
      throw error;
    });
    return this.endpoint;
  }

  private async discover(): Promise<string> {
    const response = await request(this.fetchImpl, this.discoveryUrl, {});
    return (await jsonBody(response, discoverySchema, 'discovery')).userinfo_endpoint;
  }
}
