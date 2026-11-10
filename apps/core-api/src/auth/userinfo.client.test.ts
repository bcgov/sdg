import { createJwtVerifier, type AuthUser } from '@repo/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startTestIdp, type TestIdp } from '../testing/idp.js';
import { UserinfoClient, UserinfoError } from './userinfo.client.js';

describe('UserinfoClient', () => {
  let t: TestIdp;
  let client: UserinfoClient;

  /** The token and its verified user, as the resolver hands them to the login route. */
  async function verified(claims: Record<string, unknown> = {}): Promise<{ token: string; user: AuthUser }> {
    const token = await t.portalToken(claims);
    const verifier = createJwtVerifier({ issuerUrl: t.issuer, audience: () => true, fetch: t.fetch });
    return { token, user: await verifier.verify(token) };
  }

  async function failure(token: string, user: AuthUser): Promise<UserinfoError> {
    try {
      await client.profile(token, user);
    } catch (error) {
      if (error instanceof UserinfoError) return error;
      throw error;
    }
    throw new Error('expected profile() to fail');
  }

  beforeAll(async () => {
    t = await startTestIdp();
  });

  afterAll(() => t.close());

  beforeEach(() => {
    t.reset();
    client = new UserinfoClient(t.issuer, t.fetch);
  });

  it('Should take name, email and username from userinfo and identity from the verified token', async () => {
    const { token, user } = await verified();
    const profile = await client.profile(token, user);
    expect(profile).toMatchObject({
      issuer: t.issuer,
      subject: 'resident-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailVerified: true,
      username: 'ada@bcsc',
    });
    expect(profile.claims).toMatchObject({ iss: t.issuer, sub: 'resident-1', email: 'ada@example.com' });
  });

  it('Should keep the real display name when the access token carries no profile claims (R12)', async () => {
    const { token, user } = await verified();
    expect(user.name).toBe('resident-1');
    expect((await client.profile(token, user)).name).toBe('Ada Lovelace');
  });

  it('Should discover the userinfo endpoint once and reuse it', async () => {
    const { token, user } = await verified();
    const before = t.idp.discoveryRequests;
    await client.profile(token, user);
    await client.profile(token, user);
    expect(t.idp.discoveryRequests - before).toBe(1);
    expect(t.userinfoRequests).toBe(2);
  });

  it('Should fail as unavailable when userinfo cannot be reached', async () => {
    const { token, user } = await verified();
    t.userinfoMode = 'down';
    expect((await failure(token, user)).reason).toBe('unavailable');
  });

  it('Should fail as unavailable when discovery fails, and retry discovery next time', async () => {
    const { token, user } = await verified();
    t.idp.failDiscovery = true;
    expect((await failure(token, user)).reason).toBe('unavailable');
    t.idp.failDiscovery = false;
    await expect(client.profile(token, user)).resolves.toMatchObject({ name: 'Ada Lovelace' });
  });

  it('Should fail as rejected when Keycloak refuses the token', async () => {
    const { token, user } = await verified();
    t.userinfoMode = 'reject';
    expect((await failure(token, user)).reason).toBe('rejected');
  });

  it('Should refuse a userinfo answer about another subject', async () => {
    const { token, user } = await verified();
    t.userinfoMode = 'wrong-subject';
    expect((await failure(token, user)).reason).toBe('invalid');
  });
});
