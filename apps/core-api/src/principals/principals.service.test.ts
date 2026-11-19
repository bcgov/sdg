import type { AuthUser } from '@repo/auth';
import { identities, principals, type Database } from '@repo/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import { PrincipalsService } from './principals.service.js';

const ISSUER = 'https://keycloak.example.com/realms/portal';
const PORTAL = 'portal-user';
const CONSOLE = 'console-user';

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
function withStaleLookup(db: Database): Database {
  const emptyLookup = {
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  };
  const transaction: Database['transaction'] = (run, config) =>
    db.transaction(
      (tx) =>
        run(
          new Proxy(tx, {
            get: (target, key) => (key === 'select' ? () => emptyLookup : Reflect.get(target, key)),
          }),
        ),
      config,
    );
  return new Proxy(db, {
    get: (target, key) => (key === 'transaction' ? transaction : Reflect.get(target, key)),
  });
}

/**
 * Simulates an insert returning no rows for the target table.
 */
function withFailedInsert(db: Database, targetTable: typeof principals | typeof identities): Database {
  const emptyInsert = {
    values: () => ({
      returning: () => Promise.resolve([]),
      onConflictDoUpdate: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  };
  const transaction: Database['transaction'] = (run, config) =>
    db.transaction(
      (tx) =>
        run(
          new Proxy(tx, {
            get: (target, key) => {
              if (key === 'insert') {
                return (table: typeof principals | typeof identities) => {
                  if (table === targetTable) return emptyInsert;
                  return table === principals ? tx.insert(principals) : tx.insert(identities);
                };
              }
              return Reflect.get(target, key);
            },
          }),
        ),
      config,
    );
  return new Proxy(db, {
    get: (target, key) => (key === 'transaction' ? transaction : Reflect.get(target, key)),
  });
}

/** The only identity's sign-in app markers (KTD5). */
async function signInMarks(db: Database) {
  const [identity] = await db
    .select({ portal: identities.portalSignedInAt, console: identities.consoleSignedInAt })
    .from(identities);
  return identity;
}

describe('PrincipalsService Unit Test Suite', () => {
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
    it('Should create a principal and identity and returns principalId', async () => {
      const { principalId } = await service.upsertFromLogin(user(), PORTAL);
      const [principal] = await database.db.select().from(principals);
      const [identity] = await database.db.select().from(identities);
      expect(principal).toMatchObject({
        id: principalId,
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
      });
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

    it('Should store claims without token fields', async () => {
      await service.upsertFromLogin(
        user({
          claims: {
            sub: 'sub-123',
            locale: 'en',
            access_token: 'a',
            refresh_token: 'r',
            id_token: 'i',
          },
        }),
        PORTAL,
      );
      const [identity] = await database.db.select().from(identities);
      expect(identity?.claims).toEqual({ sub: 'sub-123', locale: 'en' });
      expect(JSON.stringify(identity?.claims)).not.toMatch(/access_token|refresh_token|id_token/);
    });

    it('Should store claims without the profile claims Settings reads live (R19)', async () => {
      await service.upsertFromLogin(
        user({
          claims: {
            sub: 'sub-123',
            email: 'ada@example.com',
            locale: 'en',
            birthdate: '1815-12-10',
            gender: 'female',
            address: { formatted: '12 St James Sq' },
            phone_number: '+1 250 555 0100',
            phone_number_verified: true,
          },
        }),
        PORTAL,
      );
      const [identity] = await database.db.select().from(identities);
      expect(identity?.claims).toEqual({ sub: 'sub-123', email: 'ada@example.com', locale: 'en' });
    });
  });

  describe('returning login', () => {
    it('Should update identity and principal fields and last_login_at', async () => {
      await service.upsertFromLogin(user(), PORTAL);
      const [before] = await database.db.select().from(identities);
      await service.upsertFromLogin(
        user({
          name: 'Ada King',
          email: 'ada.king@example.com',
          emailVerified: false,
          username: 'aking',
        }),
        PORTAL,
      );
      const [principal] = await database.db.select().from(principals);
      const [identity] = await database.db.select().from(identities);
      expect(principal).toMatchObject({
        displayName: 'Ada King',
        email: 'ada.king@example.com',
      });
      expect(identity).toMatchObject({
        email: 'ada.king@example.com',
        emailVerified: false,
        username: 'aking',
      });
      expect(identity!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before!.lastLoginAt!.getTime());
      expect(identity!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    });

    it('Should keep the same principalId', async () => {
      const first = await service.upsertFromLogin(user(), PORTAL);
      const second = await service.upsertFromLogin(user({ name: 'Someone Else' }), PORTAL);
      expect(second.principalId).toBe(first.principalId);
      expect(await database.db.$count(principals)).toBe(1);
      expect(await database.db.$count(identities)).toBe(1);
      const other = await service.upsertFromLogin(user({ issuer: 'https://other.example.com/realms/x' }), PORTAL);
      expect(other.principalId).not.toBe(first.principalId);
    });
  });

  describe('concurrency', () => {
    it('Should not duplicate principals when two first logins race', async () => {
      const winner = await service.upsertFromLogin(user(), PORTAL);
      const loser = await new PrincipalsService(withStaleLookup(database.db)).upsertFromLogin(
        user({ name: 'Ada L.' }),
        PORTAL,
      );
      expect(loser.principalId).toBe(winner.principalId);
      expect(await database.db.$count(principals)).toBe(1);
      expect(await database.db.$count(identities)).toBe(1);
      const [principal] = await database.db.select().from(principals).where(eq(principals.id, winner.principalId));
      expect(principal?.displayName).toBe('Ada L.');
    });
  });

  describe('sign-in app markers (R18, KTD5)', () => {
    it('Should set portal_signed_in_at and leave console_signed_in_at null on a portal sign-in', async () => {
      const before = Date.now();
      await service.upsertFromLogin(user(), PORTAL);
      const identity = await signInMarks(database.db);
      expect(identity?.portal?.getTime()).toBeGreaterThanOrEqual(before);
      expect(identity?.console).toBeNull();
    });

    it('Should set console_signed_in_at and leave portal_signed_in_at null on a console sign-in', async () => {
      const before = Date.now();
      await service.upsertFromLogin(user(), CONSOLE);
      const identity = await signInMarks(database.db);
      expect(identity?.console?.getTime()).toBeGreaterThanOrEqual(before);
      expect(identity?.portal).toBeNull();
    });

    it('Should update portal_signed_in_at on a second portal sign-in and keep console_signed_in_at', async () => {
      await service.upsertFromLogin(user(), CONSOLE);
      await service.upsertFromLogin(user(), PORTAL);
      const first = await signInMarks(database.db);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await service.upsertFromLogin(user(), PORTAL);
      const second = await signInMarks(database.db);
      expect(second?.portal?.getTime()).toBeGreaterThan(first!.portal!.getTime());
      expect(second?.console).toEqual(first?.console);
      expect(second?.console).toBeInstanceOf(Date);
    });

    it('Should set the sign-in app marker when a racing first login resolves through the unique index', async () => {
      await service.upsertFromLogin(user(), PORTAL);
      await new PrincipalsService(withStaleLookup(database.db)).upsertFromLogin(user(), CONSOLE);
      const identity = await signInMarks(database.db);
      expect(identity?.portal).toBeInstanceOf(Date);
      expect(identity?.console).toBeInstanceOf(Date);
    });
  });

  describe('findByIdentity', () => {
    it('Should return the principal linked to an issuer and subject', async () => {
      const { principalId } = await service.upsertFromLogin(user(), PORTAL);
      expect(await service.findByIdentity(ISSUER, 'sub-123')).toEqual({
        id: principalId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
    });

    it('Should return undefined for an identity that never signed in', async () => {
      await service.upsertFromLogin(user(), PORTAL);
      expect(await service.findByIdentity(ISSUER, 'sub-unknown')).toBeUndefined();
      expect(await service.findByIdentity('https://other.example.com', 'sub-123')).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('Should throw when inserting the principal returns no row', async () => {
      const failingService = new PrincipalsService(withFailedInsert(database.db, principals));
      await expect(failingService.upsertFromLogin(user(), PORTAL)).rejects.toThrow(
        'Inserting the principal returned no row',
      );
    });

    it('Should throw when upserting the identity returns no row', async () => {
      const failingService = new PrincipalsService(withFailedInsert(database.db, identities));
      await expect(failingService.upsertFromLogin(user(), PORTAL)).rejects.toThrow(
        'Upserting the identity returned no row',
      );
    });
  });
});
