import { Injectable } from '@nestjs/common';
import { featureFlags, type FeatureFlag } from '@repo/database';

import { InjectDatabase, type Database } from '../database/database.module.js';

/** The flag fields evaluation reads. */
export type CachedFlag = Pick<FeatureFlag, 'key' | 'enabled' | 'rolloutPct' | 'audience'>;

/** How long a pod serves its cached flag table. A console change clears its own pod's copy at once; this bounds how
 * long any other replica (or a change made outside the console) can lag. */
export const FLAG_CACHE_TTL_MS = 30_000;

/**
 * The flag table in memory, so the public flag list and hello-world don't read Postgres on every page load.
 * `invalidate()` after a flag change; a load that started before it never stores its (stale) result.
 */
@Injectable()
export class FlagCache {
  private readonly db: Database;
  private cached: { readonly flags: readonly CachedFlag[]; readonly loadedAt: number } | undefined;
  private loading: Promise<readonly CachedFlag[]> | undefined;
  private generation = 0;

  constructor(@InjectDatabase() db: Database) {
    this.db = db;
  }

  /** Every flag, from memory while fresh; concurrent misses share one query. */
  flags(): Promise<readonly CachedFlag[]> {
    if (this.cached !== undefined && Date.now() - this.cached.loadedAt < FLAG_CACHE_TTL_MS) {
      return Promise.resolve(this.cached.flags);
    }
    this.loading ??= this.load();
    return this.loading;
  }

  invalidate(): void {
    this.generation += 1;
    this.cached = undefined;
    this.loading = undefined;
  }

  private async load(): Promise<readonly CachedFlag[]> {
    const generation = this.generation;
    try {
      const flags = await this.db
        .select({
          key: featureFlags.key,
          enabled: featureFlags.enabled,
          rolloutPct: featureFlags.rolloutPct,
          audience: featureFlags.audience,
        })
        .from(featureFlags);
      if (generation === this.generation) this.cached = { flags, loadedAt: Date.now() };
      return flags;
    } finally {
      if (generation === this.generation) this.loading = undefined;
    }
  }
}
