import { Injectable } from '@nestjs/common';
import { identities, principals, type FeatureFlagAudience } from '@repo/database';
import { asc, eq, ilike, isNotNull, max, or, sql, type SQL } from 'drizzle-orm';

import { InjectDatabase, type Database } from '../database/database.module.js';
import { personKind } from './person-kind.js';
import {
  PEOPLE_SEARCH_LIMIT,
  type PeopleSearch,
  type PeopleSearchResult,
  type PersonView,
} from './principals.schemas.js';

/** The query as a LIKE pattern matching it literally anywhere: `\`, `%` and `_` escaped (KTD9). */
function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const portalAt = max(identities.portalSignedInAt);
const consoleAt = max(identities.consoleSignedInAt);

/** People who signed in through an app in the audience, by KTD5's markers on any of their identities. */
const SIGNED_IN_TO: Record<FeatureFlagAudience, SQL> = {
  portal: isNotNull(portalAt),
  console: isNotNull(consoleAt),
  both: isNotNull(sql`coalesce(${portalAt}, ${consoleAt})`),
};

interface Row {
  principalId: string;
  displayName: string;
  email: string | null;
  portalAt: Date | null;
  consoleAt: Date | null;
}

function latest(...dates: (Date | null)[]): Date {
  const times = dates.filter((date): date is Date => date !== null).map((date) => date.getTime());
  return new Date(Math.max(...times));
}

function toPersonView(row: Row, audience: FeatureFlagAudience): PersonView {
  const relevant = { portal: [row.portalAt], console: [row.consoleAt], both: [row.portalAt, row.consoleAt] };
  return {
    principalId: row.principalId,
    displayName: row.displayName,
    email: row.email,
    kind: personKind({ portal: row.portalAt !== null, console: row.consoleAt !== null }, audience),
    lastSignInAt: latest(...relevant[audience]).toISOString(),
  };
}

/** Finds people for console admins to target with a flag override (R18). */
@Injectable()
export class PeopleSearchService {
  private readonly db: Database;

  constructor(@InjectDatabase() db: Database) {
    this.db = db;
  }

  /** Case-insensitive substring match on display name or email, by name, `limit + 1` rows to tell `more`. */
  async search({ query, audience }: PeopleSearch): Promise<PeopleSearchResult> {
    const pattern = containsPattern(query);
    const rows: Row[] = await this.db
      .select({
        principalId: principals.id,
        displayName: principals.displayName,
        email: principals.email,
        portalAt,
        consoleAt,
      })
      .from(principals)
      .innerJoin(identities, eq(identities.principalId, principals.id))
      .where(or(ilike(principals.displayName, pattern), ilike(principals.email, pattern)))
      .groupBy(principals.id)
      .having(SIGNED_IN_TO[audience])
      .orderBy(asc(principals.displayName), asc(principals.id))
      .limit(PEOPLE_SEARCH_LIMIT + 1);
    return {
      results: rows.slice(0, PEOPLE_SEARCH_LIMIT).map((row) => toPersonView(row, audience)),
      more: rows.length > PEOPLE_SEARCH_LIMIT,
    };
  }
}
