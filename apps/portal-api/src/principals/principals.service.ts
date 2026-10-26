import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@repo/auth';
import { identities, principals, type IdentityClaims } from '@repo/portal-database';
import { and, eq } from 'drizzle-orm';

import { InjectDatabase, type PortalDatabase } from '../database/database.module.js';

/** Claims that must never be persisted, even if an IdP echoes them into the ID token. */
const TOKEN_CLAIMS: ReadonlySet<string> = new Set(['access_token', 'refresh_token', 'id_token']);

export function persistableClaims(claims: Readonly<Record<string, unknown>>): IdentityClaims {
  return Object.fromEntries(Object.entries(claims).filter(([key]) => !TOKEN_CLAIMS.has(key)));
}

@Injectable()
export class PrincipalsService {
  private readonly db: PortalDatabase;

  constructor(@InjectDatabase() db: PortalDatabase) {
    this.db = db;
  }

  /**
   * Creates or refreshes the principal and identity for a login, in one transaction.
   * The identity is keyed by (issuer, subject); a racing first login resolves through the unique index.
   */
  upsertFromLogin(user: AuthUser): Promise<{ principalId: string }> {
    const now = new Date();
    const identityFields = {
      email: user.email,
      emailVerified: user.emailVerified,
      username: user.username,
      claims: persistableClaims(user.claims),
      lastLoginAt: now,
      updatedAt: now,
    };
    const principalFields = { displayName: user.name, email: user.email, lastLoginAt: now, updatedAt: now };
    const byKey = and(eq(identities.issuer, user.issuer), eq(identities.subject, user.subject));

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ principalId: identities.principalId })
        .from(identities)
        .where(byKey)
        .limit(1);
      if (existing) {
        await Promise.all([
          tx.update(identities).set(identityFields).where(byKey),
          tx.update(principals).set(principalFields).where(eq(principals.id, existing.principalId)),
        ]);
        return { principalId: existing.principalId };
      }

      const [created] = await tx.insert(principals).values(principalFields).returning({ id: principals.id });
      if (!created) throw new Error('Inserting the principal returned no row');
      const [identity] = await tx
        .insert(identities)
        .values({ ...identityFields, principalId: created.id, issuer: user.issuer, subject: user.subject })
        .onConflictDoUpdate({ target: [identities.issuer, identities.subject], set: identityFields })
        .returning({ principalId: identities.principalId });
      if (!identity) throw new Error('Upserting the identity returned no row');

      if (identity.principalId !== created.id) {
        // A concurrent first login won the race: keep its principal and drop the one created here.
        await tx.delete(principals).where(eq(principals.id, created.id));
        await tx.update(principals).set(principalFields).where(eq(principals.id, identity.principalId));
      }
      return { principalId: identity.principalId };
    });
  }
}
