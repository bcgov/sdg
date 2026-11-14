import { Injectable, NotFoundException } from '@nestjs/common';
import { featureFlagOverrides } from '@repo/database';
import { and, eq } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../database/database.module.js';
import { inAudience, kindOf, lockFlag, overrideTargets, recordEvent, type Actor } from './feature-flag-records.js';
import type { OverrideView } from './feature-flags.schemas.js';

/**
 * Per-person overrides of a flag (R18). Every write first locks the flag's row, which serializes override writes per
 * flag (so each event's `from` is right, even for a first insert) and turns a concurrently deleted flag into a 404.
 */
@Injectable()
export class FeatureFlagOverridesService {
  private readonly db: Database;

  constructor(@InjectDatabase() db: Database) {
    this.db = db;
  }

  /**
   * Forces the flag on or off for one person, who must have signed in to an app in its audience (KTD5); 404 otherwise
   * or when the flag doesn't exist. Records `override_set` only when the value changes.
   */
  set(key: string, principalId: string, enabled: boolean, actor: Actor): Promise<OverrideView> {
    return this.db.transaction(async (tx) => {
      const flag = await lockFlag(tx, key);
      const [target] = await overrideTargets(tx, [principalId]);
      if (target === undefined || !inAudience(target, flag.audience)) {
        throw new NotFoundException(`No one who signs in to this flag's apps has principal id ${principalId}`);
      }
      const [existing] = await tx
        .select({ enabled: featureFlagOverrides.enabled })
        .from(featureFlagOverrides)
        .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.userId, principalId)));
      if (existing?.enabled !== enabled) {
        await tx
          .insert(featureFlagOverrides)
          .values({ flagKey: key, userId: principalId, enabled })
          .onConflictDoUpdate({
            target: [featureFlagOverrides.flagKey, featureFlagOverrides.userId],
            set: { enabled },
          });
        const changes = { enabled: { from: existing?.enabled ?? null, to: enabled } };
        await recordEvent(tx, { flagKey: key, action: 'override_set', changes, subject: principalId }, actor);
      }
      const { name, email } = target;
      return { principalId, name, email, kind: kindOf(target, flag.audience), enabled };
    });
  }

  /** Removes one person's override and records `override_removed`; 404 when the flag or the override doesn't exist. */
  remove(key: string, principalId: string, actor: Actor): Promise<void> {
    return this.db.transaction(async (tx) => {
      await lockFlag(tx, key);
      const [removed] = await tx
        .delete(featureFlagOverrides)
        .where(and(eq(featureFlagOverrides.flagKey, key), eq(featureFlagOverrides.userId, principalId)))
        .returning({ enabled: featureFlagOverrides.enabled });
      if (removed === undefined) throw new NotFoundException(`Feature flag ${key} has no override for ${principalId}`);
      const changes = { enabled: { from: removed.enabled, to: null } };
      await recordEvent(tx, { flagKey: key, action: 'override_removed', changes, subject: principalId }, actor);
    });
  }
}
