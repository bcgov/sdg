import type { AuthFetch } from '@repo/auth';
import { startFakeIdp, type FakeIdp } from '@repo/auth/testing';
import { z } from 'zod';

export const PORTAL_CLIENT_ID = 'sdg-portal';
export const ADMIN_CLIENT_ID = 'sdg-admin';
export const SERVICE_CLIENT_ID = 'partner-client';

/** How the fake userinfo endpoint answers. */
export type UserinfoMode = 'ok' | 'down' | 'reject' | 'wrong-subject';

export interface TestIdp {
  idp: FakeIdp;
  issuer: string;
  /** The fake IdP's fetch plus a userinfo endpoint (advertised in discovery) the fake IdP lacks. */
  fetch: AuthFetch;
  /** Profile claims userinfo returns, with the token's `sub`. */
  profile: Record<string, unknown>;
  userinfoMode: UserinfoMode;
  userinfoRequests: number;
  /** A person token issued to the portal client. */
  portalToken: (claims?: Record<string, unknown>) => Promise<string>;
  /** A person token issued to the admin client, holding `roles` in `client_roles`. */
  adminToken: (roles: string[], claims?: Record<string, unknown>) => Promise<string>;
  /** A client-credentials token, as Keycloak issues it to a service account. */
  serviceAccountToken: (clientId?: string) => Promise<string>;
  /** A person token from a client core-api does not know. */
  unknownClientToken: () => Promise<string>;
  reset: () => void;
  close: () => Promise<void>;
}

export const DEFAULT_PROFILE: Readonly<Record<string, unknown>> = {
  name: 'Ada Lovelace',
  given_name: 'Ada',
  family_name: 'Lovelace',
  email: 'ada@example.com',
  email_verified: true,
  preferred_username: 'ada@bcsc',
};

const payloadSchema = z.object({ sub: z.string() });

/** The `sub` of an unverified JWT: the fake userinfo endpoint answers for whoever the token names. */
function tokenSubject(authorization: string | null): string | undefined {
  const payload = authorization?.replace(/^Bearer /, '').split('.')[1];
  if (payload === undefined) return undefined;
  const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  return parsed.success ? parsed.data.sub : undefined;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function userinfo(state: TestIdp, init: RequestInit): Response {
  state.userinfoRequests += 1;
  if (state.userinfoMode === 'down') throw new TypeError('fetch failed: connect ECONNREFUSED');
  const sub = tokenSubject(new Headers(init.headers).get('authorization'));
  if (state.userinfoMode === 'reject' || sub === undefined) return json(401, { error: 'invalid_token' });
  return json(200, { ...state.profile, sub: state.userinfoMode === 'wrong-subject' ? 'someone-else' : sub });
}

function withUserinfo(state: TestIdp): AuthFetch {
  return async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname === '/userinfo') return userinfo(state, init);
    const response = await state.idp.fetch(url, init);
    if (pathname !== '/.well-known/openid-configuration' || !response.ok) return response;
    const metadata = z.record(z.string(), z.unknown()).parse(await response.json());
    return json(200, { ...metadata, userinfo_endpoint: `${state.issuer}/userinfo` });
  };
}

/** The `@repo/auth` fake IdP with a userinfo endpoint, and the token shapes Keycloak issues to each kind of caller. */
export async function startTestIdp(): Promise<TestIdp> {
  const idp = await startFakeIdp();
  const person = (azp: string, claims: Record<string, unknown>) =>
    idp.sign({ sub: 'resident-1', azp, typ: 'Bearer', ...claims }, { audience: 'account' });
  const state: TestIdp = {
    idp,
    issuer: idp.issuer,
    fetch: (url, init) => withUserinfo(state)(url, init),
    profile: { ...DEFAULT_PROFILE },
    userinfoMode: 'ok',
    userinfoRequests: 0,
    portalToken: (claims = {}) => person(PORTAL_CLIENT_ID, claims),
    adminToken: (roles, claims = {}) => person(ADMIN_CLIENT_ID, { sub: 'idir-1', client_roles: roles, ...claims }),
    serviceAccountToken: (clientId = SERVICE_CLIENT_ID) =>
      idp.sign(
        { sub: 'svc-1', azp: clientId, client_id: clientId, preferred_username: `service-account-${clientId}` },
        { audience: 'account' },
      ),
    unknownClientToken: () => person('someone-else', {}),
    reset: () => {
      state.profile = { ...DEFAULT_PROFILE };
      state.userinfoMode = 'ok';
      state.userinfoRequests = 0;
      idp.failDiscovery = false;
      idp.failJwks = false;
    },
    close: () => idp.close(),
  };
  return state;
}
