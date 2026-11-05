import { Controller, Get, Module, UseGuards, type DynamicModule } from '@nestjs/common';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LoggingModule } from '../logging/logging.module.js';
import { createTestApp, type TestApp } from '../testing/app.js';
import { OWN_CLIENT_ID, RELAYING_CLIENT_ID, startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { AdminGuard } from './admin.guard.js';
import { AuthModule } from './auth.module.js';
import { CredentialGuard } from './credential.guard.js';
import { CurrentPrincipal } from './current-principal.decorator.js';
import {
  CREDENTIAL_DIRECTORY,
  InMemoryCredentialDirectory,
  InMemorySenderOwnership,
  SENDER_OWNERSHIP,
} from './directories.js';
import { OwnerGuard } from './owner.guard.js';
import { RecipientGuard } from './recipient.guard.js';
import { ADMIN_ROLE, type Principal } from './token-kind.js';

/** Stands in for recipient creation: recipient endpoints are where a recipient would be created. */
const recipientHandler = vi.fn<(principal: Principal) => { kind: string; subject: string }>((principal) => ({
  kind: principal.kind,
  subject: principal.subject,
}));

/** Test-only endpoints, one per endpoint class. */
@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Get('credential')
  @UseGuards(CredentialGuard)
  credential(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  admin(@CurrentPrincipal() principal: Principal): { kind: string; subject: string } {
    return { kind: principal.kind, subject: principal.subject };
  }

  @Get('senders/:senderId')
  @UseGuards(OwnerGuard)
  owner(@CurrentPrincipal() principal: Principal): { kind: string; subject: string } {
    return { kind: principal.kind, subject: principal.subject };
  }

  @Get('recipient')
  @UseGuards(RecipientGuard)
  recipient(@CurrentPrincipal() principal: Principal): { kind: string; subject: string } {
    return recipientHandler(principal);
  }
}

/** AuthModule with its default in-memory directories, which these tests fill in directly. */
@Module({})
class GuardsTestModule {}
const guardsTestModule = (): DynamicModule => ({
  module: GuardsTestModule,
  imports: [AppConfigModule.register(), LoggingModule, DatabaseModule, AuthModule.register()],
});

const LINKED_CLIENT = 'permits-sender';
const UNLINKED_CLIENT = 'some-other-service';
const PERMITS = { senderId: 'sender-a', credentialId: 'cred-1', scopedTypes: ['permit-approved'] };
const OWNER = 'owner-of-a';
const ENDPOINTS = {
  credential: '/api/v1/probe/credential',
  admin: '/api/v1/probe/admin',
  ownerOfA: '/api/v1/probe/senders/sender-a',
  ownerOfB: '/api/v1/probe/senders/sender-b',
  recipient: '/api/v1/probe/recipient',
} as const;
type Endpoint = keyof typeof ENDPOINTS;

let t: TestApp;
let issuer: TestIssuer;
let credentials: InMemoryCredentialDirectory;

async function status(endpoint: Endpoint, token: string | null): Promise<number> {
  const request = t.http().get(ENDPOINTS[endpoint]);
  return (await (token === null ? request : request.set('authorization', `Bearer ${token}`))).status;
}

/** The status of each endpoint class for one token. */
async function statuses(token: string): Promise<Record<Endpoint, number>> {
  const [credential, admin, ownerOfA, ownerOfB, recipient] = await Promise.all([
    status('credential', token),
    status('admin', token),
    status('ownerOfA', token),
    status('ownerOfB', token),
    status('recipient', token),
  ]);
  return { credential, admin, ownerOfA, ownerOfB, recipient };
}

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({
    env: issuer.env,
    issuerFetch: issuer.fetch,
    controllers: [ProbeController],
    module: guardsTestModule,
  });
  credentials = t.app.get<InMemoryCredentialDirectory>(CREDENTIAL_DIRECTORY);
  credentials.link(LINKED_CLIENT, PERMITS);
  // R8: these can never be credentials, even if a link to them existed.
  credentials.link(RELAYING_CLIENT_ID, PERMITS);
  credentials.link(OWN_CLIENT_ID, PERMITS);
  t.app.get<InMemorySenderOwnership>(SENDER_OWNERSHIP).addOwner('sender-a', { issuer: issuer.issuer, subject: OWNER });
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

beforeEach(() => {
  vi.restoreAllMocks();
  recipientHandler.mockClear();
});

describe('endpoint-class guards', () => {
  it('accept a linked credential on credential endpoints only, with its sender and scoped types', async () => {
    const token = await issuer.credentialToken(LINKED_CLIENT);
    expect(await statuses(token)).toEqual({
      credential: 200,
      admin: 403,
      ownerOfA: 403,
      ownerOfB: 403,
      recipient: 403,
    });
    const res = await t.http().get(ENDPOINTS.credential).set('authorization', `Bearer ${token}`);
    expect(res.body).toMatchObject({ kind: 'credential', clientId: LINKED_CLIENT, credential: PERMITS });
  });

  it('accept an admin on admin and every sender-owner endpoint, nowhere else', async () => {
    const token = await issuer.ownClientUserToken({ admin: true });
    expect(await statuses(token)).toEqual({
      credential: 403,
      admin: 200,
      ownerOfA: 200,
      ownerOfB: 200,
      recipient: 403,
    });
  });

  it('accept an own-client user without the admin role only on senders they own', async () => {
    const token = await issuer.ownClientUserToken({ subject: OWNER });
    expect(await statuses(token)).toEqual({
      credential: 403,
      admin: 403,
      ownerOfA: 200,
      ownerOfB: 403,
      recipient: 403,
    });
    const stranger = await issuer.ownClientUserToken({ subject: 'not-an-owner' });
    expect(await status('ownerOfA', stranger)).toBe(403);
  });

  it('accept a relaying-app user token on recipient endpoints only', async () => {
    const token = await issuer.relayingUserToken({ subject: 'citizen-1' });
    expect(await statuses(token)).toEqual({
      credential: 403,
      admin: 403,
      ownerOfA: 403,
      ownerOfB: 403,
      recipient: 200,
    });
    expect(recipientHandler).toHaveBeenCalledTimes(1);
  });

  it('ignore the admin role on a relaying-app token', async () => {
    const token = await issuer.relayingUserToken({ admin: true });
    expect(await status('admin', token)).toBe(403);
  });

  // BC Gov's SSO service (the standard realm) puts the token's own client roles in a top-level `client_roles` claim
  // instead of `resource_access`.
  it('accept the admin role from the top-level client_roles claim of an own-client token', async () => {
    const [admin, other] = await Promise.all([
      issuer.ownClientUserToken({ claims: { client_roles: [ADMIN_ROLE] } }),
      issuer.ownClientUserToken({ claims: { client_roles: ['viewer'] } }),
    ]);
    expect(await status('admin', admin)).toBe(200);
    expect(await status('admin', other)).toBe(403);
  });

  it('ignore client_roles admin on a relaying-app token', async () => {
    const token = await issuer.relayingUserToken({ claims: { client_roles: [ADMIN_ROLE] } });
    expect(await status('admin', token)).toBe(403);
  });

  it('reject a user token issued to a linked credential client everywhere with 401', async () => {
    const token = await issuer.userToken(LINKED_CLIENT);
    expect(await statuses(token)).toEqual({
      credential: 401,
      admin: 401,
      ownerOfA: 401,
      ownerOfB: 401,
      recipient: 401,
    });
  });

  it('never let a service-account token reach a recipient endpoint', async () => {
    const tokens = await Promise.all([
      issuer.credentialToken(LINKED_CLIENT),
      issuer.credentialToken(RELAYING_CLIENT_ID),
      issuer.credentialToken(OWN_CLIENT_ID),
      // A service account recognized only by its username, without the client_id claim.
      issuer.userToken(RELAYING_CLIENT_ID, { claims: { preferred_username: `service-account-${RELAYING_CLIENT_ID}` } }),
      // ... and one recognized only by its client_id claim.
      issuer.userToken(RELAYING_CLIENT_ID, { claims: { client_id: RELAYING_CLIENT_ID } }),
    ]);
    const results = await Promise.all(tokens.map((token) => status('recipient', token)));
    expect(results).toEqual([403, 401, 401, 401, 401]);
    expect(recipientHandler).not.toHaveBeenCalled();
  });

  it('never treat the own or a relaying client service account as a credential (R8)', async () => {
    const tokens = await Promise.all([
      issuer.credentialToken(RELAYING_CLIENT_ID),
      issuer.credentialToken(OWN_CLIENT_ID),
    ]);
    expect(await Promise.all(tokens.map((token) => status('credential', token)))).toEqual([401, 401]);
  });

  it('accept a credential linked after startup without a restart', async () => {
    const token = await issuer.credentialToken('late-client');
    expect(await status('credential', token)).toBe(401);
    credentials.link('late-client', { ...PERMITS, credentialId: 'cred-late' });
    expect(await status('credential', token)).toBe(200);
  });

  it('reject an unlinked service account even with notification-api as its audience', async () => {
    const token = await issuer.credentialToken(UNLINKED_CLIENT, { sign: { audience: OWN_CLIENT_ID } });
    expect(await status('credential', token)).toBe(401);
  });
});

describe('token verification', () => {
  it('rejects expired, wrong-issuer, wrong-audience and HS256 tokens with 401 on every endpoint class', async () => {
    const expired = await issuer.ownClientUserToken({
      admin: true,
      sign: { expiresIn: Math.floor(Date.now() / 1000) - 120 },
    });
    const wrongIssuer = await issuer.ownClientUserToken({ admin: true, sign: { issuer: 'https://evil.example' } });
    const wrongAudience = await issuer.ownClientUserToken({ admin: true, sign: { audience: UNLINKED_CLIENT } });
    const hs256 = await new SignJWT({ sub: 'x', azp: OWN_CLIENT_ID, iss: issuer.issuer, aud: OWN_CLIENT_ID })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough!!'));
    const all401 = { credential: 401, admin: 401, ownerOfA: 401, ownerOfB: 401, recipient: 401 };
    const results = await Promise.all([expired, wrongIssuer, wrongAudience, hs256, 'not-a-jwt'].map(statuses));
    expect(results).toEqual([all401, all401, all401, all401, all401]);
  });

  it('rejects a request without a bearer token with 401', async () => {
    expect(await status('recipient', null)).toBe(401);
  });

  it('answers 500, not 401, when the credential lookup fails', async () => {
    vi.spyOn(credentials, 'findByClientId').mockRejectedValue(new Error('database unavailable'));
    expect(await status('credential', await issuer.credentialToken(LINKED_CLIENT))).toBe(500);
  });
});
