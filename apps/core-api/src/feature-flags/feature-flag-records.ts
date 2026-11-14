import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  featureFlagEvents,
  featureFlags,
  identities,
  principals,
  type FeatureFlag,
  type FeatureFlagAudience,
  type FeatureFlagEventAction,
  type FeatureFlagEventChanges,
} from '@repo/database';
import { eq, inArray, sql } from 'drizzle-orm';

import type { Caller } from '../auth/caller.js';
import type { Database } from '../database/database.module.js';
import type { PrincipalsService } from '../principals/principals.service.js';

/** The administrator making a flag change: their principal id and current display name. */
export interface Actor {
  principalId: string;
  name: string;
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The administrator's principal, looked up by identity as the registry does; 403 if they never signed in. */
export async function actorOf(people: PrincipalsService, caller: Caller): Promise<Actor> {
  const principal = await people.findByIdentity(caller.user.issuer, caller.user.subject);
  if (principal === undefined) throw new ForbiddenException('Sign in before changing feature flags');
  return { principalId: principal.id, name: principal.name };
}

export const missingFlag = (key: string): NotFoundException => new NotFoundException(`No feature flag ${key} exists`);

/**
 * Locks the flag's row for the rest of the transaction (`FOR UPDATE`), serializing every change to it and its
 * overrides; 404 when it doesn't exist, or a concurrent delete has removed it.
 */
export async function lockFlag(tx: Transaction, key: string): Promise<FeatureFlag> {
  const [flag] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key)).for('update');
  if (flag === undefined) throw missingFlag(key);
  return flag;
}

export function recordEvent(
  tx: Transaction,
  event: { flagKey: string; action: FeatureFlagEventAction; changes: FeatureFlagEventChanges; subject?: string },
  actor: Actor,
): Promise<unknown> {
  return tx.insert(featureFlagEvents).values({
    flagKey: event.flagKey,
    action: event.action,
    actorPrincipalId: actor.principalId,
    actorName: actor.name,
    subjectPrincipalId: event.subject ?? null,
    changes: event.changes,
  });
}

/** A person an override can target: their current name and email, and which apps they have signed in to (KTD5). */
export interface OverrideTarget {
  principalId: string;
  name: string;
  email: string | null;
  portal: boolean;
  console: boolean;
}

/** The principals with these ids, with their sign-in markers read from `core.identities`. */
export function overrideTargets(db: Database | Transaction, ids: string[]): Promise<OverrideTarget[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      principalId: principals.id,
      name: principals.displayName,
      email: principals.email,
      portal: sql<boolean>`coalesce(bool_or(${identities.portalSignedInAt} is not null), false)`,
      console: sql<boolean>`coalesce(bool_or(${identities.consoleSignedInAt} is not null), false)`,
    })
    .from(principals)
    .leftJoin(identities, eq(identities.principalId, principals.id))
    .where(inArray(principals.id, ids))
    .groupBy(principals.id);
}

/** Whether a person has signed in to an app in the flag's audience, so an override may target them (R18). */
export function inAudience(target: OverrideTarget, audience: FeatureFlagAudience): boolean {
  if (audience === 'portal') return target.portal;
  if (audience === 'console') return target.console;
  return target.portal || target.console;
}
