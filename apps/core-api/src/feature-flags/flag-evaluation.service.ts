import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { featureFlagOverrides } from '@repo/database';
import { eq } from 'drizzle-orm';

import type { Caller } from '../auth/caller.js';
import { InjectDatabase, type Database } from '../database/database.module.js';
import { PrincipalsService } from '../principals/principals.service.js';
import { FlagCache } from './flag-cache.service.js';
import { isEnabled, type Flags, type Overrides } from './is-enabled.js';

/** The app a caller is using: no token or a portal token means portal, a console token means console (KTD1). */
type FlagApp = 'portal' | 'console';

const audiencesOf = (app: FlagApp) => [app, 'both'] as const;

/**
 * Which flags are on for a caller, read fresh on every call (KTD10). A signed-in person is evaluated with
 * `isEnabled` on their principal id (R3); a signed-out portal visitor gets only flags on at 100% (R4). A person
 * token with no principal evaluates as signed out: R4 on the portal, nothing on the console (KTD4).
 */
@Injectable()
export class FlagEvaluationService {
  private readonly logger = new Logger(FlagEvaluationService.name);
  private readonly db: Database;
  private readonly principals: PrincipalsService;
  private readonly cache: FlagCache;

  constructor(
    @InjectDatabase() db: Database,
    @Inject(PrincipalsService) principals: PrincipalsService,
    @Inject(FlagCache) cache: FlagCache,
  ) {
    this.db = db;
    this.principals = principals;
    this.cache = cache;
  }

  /** The keys of the flags on for this caller, among those whose audience includes the caller's app (R6). */
  async enabledKeys(caller: Caller | undefined): Promise<Set<string>> {
    if (caller === undefined) return this.signedOut();
    // OptionalSharedGuard already refuses service accounts; this keeps the service safe on its own.
    if (caller.kind === 'service-account') throw new ForbiddenException();
    const app: FlagApp = caller.kind === 'portal-user' ? 'portal' : 'console';
    const [flags, principal] = await Promise.all([
      this.flagsFor(app),
      this.principals.findByIdentity(caller.user.issuer, caller.user.subject),
    ]);
    if (principal === undefined) {
      this.logger.warn({ msg: 'A person token with no principal evaluated feature flags as signed out', app });
      return app === 'portal' ? this.signedOut() : new Set();
    }
    const overrides = await this.overridesOf(principal.id);
    return new Set([...flags.keys()].filter((key) => isEnabled(key, principal.id, flags, overrides)));
  }

  /** R4: the portal and both-audience flags that are on at 100%. */
  private async signedOut(): Promise<Set<string>> {
    const audiences: readonly string[] = audiencesOf('portal');
    const flags = await this.cache.flags();
    return new Set(
      flags
        .filter((flag) => audiences.includes(flag.audience) && flag.enabled && flag.rolloutPct === 100)
        .map(({ key }) => key),
    );
  }

  private async flagsFor(app: FlagApp): Promise<Flags> {
    const audiences: readonly string[] = audiencesOf(app);
    const flags = await this.cache.flags();
    return new Map(flags.filter((flag) => audiences.includes(flag.audience)).map((flag) => [flag.key, flag]));
  }

  /** The principal's overrides, keyed `${flagKey}:${principalId}` as `isEnabled` reads them. */
  private async overridesOf(principalId: string): Promise<Overrides> {
    const rows = await this.db
      .select({ flagKey: featureFlagOverrides.flagKey, enabled: featureFlagOverrides.enabled })
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.userId, principalId));
    return new Map(rows.map(({ flagKey, enabled }) => [`${flagKey}:${principalId}`, enabled]));
  }
}
