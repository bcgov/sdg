import type { AuthUser } from '@repo/auth';
import { identities, principals, type PortalDatabase } from '@repo/portal-database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import { PrincipalsService } from './principals.service.js';

const ISSUER = 'https://keycloak.example.com/realms/portal';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    issuer: ISSUER,
    subject: 'sub-123',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    emailVerified: true,
    username: 'ada',
    claims: { iss: ISSUER, sub: 'sub-123', name: 'Ada Lovelace' },
    ...overrides,
  };
}

/**
 * Simulates losing a first-login race: the identity lookup inside the transaction sees no row
 * (as if another transaction had not committed yet), but the row exists by the time of the insert.
 */
function withStaleLookup(db: PortalDatabase): PortalDatabase {
  const emptyLookup = { from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) };
  const transaction: PortalDatabase['transaction'] = (run, config) =>
    db.transaction(
      (tx) =>
        run(new Proxy(tx, { get: (target, key) => (key === 'select' ? () => emptyLookup : Reflect.get(target, key)) })),
      config,
    );
  return new Proxy(db, { get: (target, key) => (key === 'transaction' ? transaction : Reflect.get(target, key)) });
}

describe('PrincipalsService.upsertFromLogin', () => {
  let database: TestDatabase;
  let service: PrincipalsService;

  beforeAll(async () => {
    database = await createTestDatabase();
    service = new PrincipalsService(database.db);
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await database.db.delete(principals);
  });

  describe('first login', () => {
    it('creates a principal and identity and returns principalId', async () => {
      const { principalId } = await service.upsertFromLogin(user());
      const [principal] = await database.db.select().from(principals);
      const [identity] = await database.db.select().from(identities);
      expect(principal).toMatchObject({ id: principalId, displayName: 'Ada Lovelace', email: 'ada@example.com' });
      expect(principal?.lastLoginAt).toBeInstanceOf(Date);
      expect(identity).toMatchObject({
        principalId,
        issuer: ISSUER,
        subject: 'sub-123',
        email: 'ada@example.com',
        emailVerified: true,
        username: 'ada',
      });
    });

    it('stores claims without token fields', async () => {
      await service.upsertFromLogin(
        user({ claims: { sub: 'sub-123', locale: 'en', access_token: 'a', refresh_token: 'r', id_token: 'i' } }),
      );
      const [identity] = await database.db.select().from(identities);
      expect(identity?.claims).toEqual({ sub: 'sub-123', locale: 'en' });
      expect(JSON.stringify(identity?.claims)).not.toMatch(/access_token|refresh_token|id_token/);
    });
  });

  describe('returning login', () => {
    it('updates identity and principal fields and last_login_at', async () => {
      await service.upsertFromLogin(user());
      const [before] = await database.db.select().from(identities);
      await service.upsertFromLogin(
        user({ name: 'Ada King', email: 'ada.king@example.com', emailVerified: false, username: 'aking' }),
      );
      const [principal] = await database.db.select().from(principals);
      const [identity] = await database.db.select().from(identities);
      expect(principal).toMatchObject({ displayName: 'Ada King', email: 'ada.king@example.com' });
      expect(identity).toMatchObject({ email: 'ada.king@example.com', emailVerified: false, username: 'aking' });
      expect(identity!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before!.lastLoginAt!.getTime());
      expect(identity!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    });

    it('keeps the same principalId', async () => {
      const first = await service.upsertFromLogin(user());
      const second = await service.upsertFromLogin(user({ name: 'Someone Else' }));
      expect(second.principalId).toBe(first.principalId);
      expect(await database.db.$count(principals)).toBe(1);
      expect(await database.db.$count(identities)).toBe(1);
      const other = await service.upsertFromLogin(user({ issuer: 'https://other.example.com/realms/x' }));
      expect(other.principalId).not.toBe(first.principalId);
    });
  });

  describe('concurrency', () => {
    it('does not duplicate principals when two first logins race', async () => {
      const winner = await service.upsertFromLogin(user());
      const loser = await new PrincipalsService(withStaleLookup(database.db)).upsertFromLogin(user({ name: 'Ada L.' }));
      expect(loser.principalId).toBe(winner.principalId);
      expect(await database.db.$count(principals)).toBe(1);
      expect(await database.db.$count(identities)).toBe(1);
      const [principal] = await database.db.select().from(principals).where(eq(principals.id, winner.principalId));
      expect(principal?.displayName).toBe('Ada L.');
    });
  });
});
