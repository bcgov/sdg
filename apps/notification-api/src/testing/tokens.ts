import { randomUUID } from 'node:crypto';

import { startFakeIdp, type FakeIdp, type SignOptions } from '@repo/auth/testing';
import type { JWTPayload } from 'jose';

import { ADMIN_ROLE } from '../auth/token-kind.js';
import type { HttpFetch } from '../health/indicators.js';
import { requestUrl, TEST_ENV } from './app.js';

export const OWN_CLIENT_ID = TEST_ENV.NOTIFICATION_CLIENT_ID;
export const RELAYING_CLIENT_ID = TEST_ENV.RELAYING_CLIENT_IDS;

export interface UserTokenOptions {
  /** Default: a random subject. */
  subject?: string;
  /** Adds the admin client role on notification-api's own client. */
  admin?: boolean;
  /** Extra or replacement claims. */
  claims?: JWTPayload;
  sign?: SignOptions;
}

/**
 * A fake Keycloak realm that signs tokens shaped like the standard realm's, for tests that exercise the guards.
 * Pass `env` and `fetch` to `createTestApp({ env: issuer.env, issuerFetch: issuer.fetch })` so the app's verifier
 * trusts it.
 */
export interface TestIssuer {
  readonly issuer: string;
  /** Points KEYCLOAK_ISSUER_URL at the fake issuer. */
  readonly env: Record<string, string>;
  /** Routes the issuer's discovery and JWKS requests to the in-process server. */
  readonly fetch: HttpFetch;
  /** A client-credentials token of `clientId`'s service account (`client_id`, `service-account-…`). */
  credentialToken(clientId: string, options?: Omit<UserTokenOptions, 'admin'>): Promise<string>;
  /** A person's token issued to `clientId`. */
  userToken(clientId: string, options?: UserTokenOptions): Promise<string>;
  /** A person's token issued to notification-api's own client (admin and owner endpoints). */
  ownClientUserToken(options?: UserTokenOptions): Promise<string>;
  /** A person's token issued to the relaying portal client (recipient endpoints). */
  relayingUserToken(options?: UserTokenOptions): Promise<string>;
  /** Signs arbitrary claims with the issuer's key. */
  sign(claims: JWTPayload, options?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

function userClaims(clientId: string, options: UserTokenOptions): JWTPayload {
  const subject = options.subject ?? randomUUID();
  return {
    sub: subject,
    azp: clientId,
    typ: 'Bearer',
    preferred_username: `${subject}@idir`,
    email: `${subject}@example.gov.bc.ca`,
    email_verified: true,
    ...(options.admin ? { resource_access: { [OWN_CLIENT_ID]: { roles: [ADMIN_ROLE] } } } : {}),
    ...options.claims,
  };
}

export async function startTestIssuer(): Promise<TestIssuer> {
  const idp: FakeIdp = await startFakeIdp();
  const userToken = (clientId: string, options: UserTokenOptions = {}): Promise<string> =>
    idp.sign(userClaims(clientId, options), { audience: clientId, ...options.sign });

  return {
    issuer: idp.issuer,
    env: { KEYCLOAK_ISSUER_URL: idp.issuer },
    fetch: (input, init) => idp.fetch(requestUrl(input), init ?? {}),
    credentialToken: (clientId, options = {}) =>
      idp.sign(
        {
          sub: options.subject ?? randomUUID(),
          azp: clientId,
          client_id: clientId,
          typ: 'Bearer',
          preferred_username: `service-account-${clientId}`,
          ...options.claims,
        },
        { audience: clientId, ...options.sign },
      ),
    userToken,
    ownClientUserToken: (options) => userToken(OWN_CLIENT_ID, options),
    relayingUserToken: (options) => userToken(RELAYING_CLIENT_ID, options),
    sign: (claims, options) => idp.sign(claims, options),
    close: () => idp.close(),
  };
}
