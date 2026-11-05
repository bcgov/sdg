import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';

import type { Channel } from '../channels/channels.js';
import type { NotificationDatabase } from '../database/database.module.js';
import { fragmentVersions, templateVersions, type FragmentKind } from '../database/schema/index.js';

/** The database or a transaction on it (sends pin templates inside the accept transaction). */
export type Queryable = Pick<NotificationDatabase, 'select' | 'selectDistinctOn'>;

export interface FragmentRow {
  id: string;
  kind: FragmentKind;
  name: string;
  version: number;
  source: string;
  references: string[];
  createdAt: Date;
}

export interface TemplateRow {
  id: string;
  typeKey: string;
  channel: Channel;
  language: string;
  version: number;
  parts: Record<string, string>;
  references: string[];
  createdAt: Date;
}

/** A layout or partial as a render needs it. */
export interface PinnedFragment {
  id: string;
  source: string;
  references: string[];
}

/** The newest version of each named layout or partial. */
export function currentFragments(db: Queryable, names: readonly string[]): Promise<FragmentRow[]> {
  if (names.length === 0) return Promise.resolve([]);
  return db
    .selectDistinctOn([fragmentVersions.name])
    .from(fragmentVersions)
    .where(inArray(fragmentVersions.name, [...names]))
    .orderBy(asc(fragmentVersions.name), desc(fragmentVersions.version));
}

/** A layout or partial standing in for the current version of its name. */
export interface FragmentCandidate {
  name: string;
  fragment: PinnedFragment;
}

/** Adds the fragments `pending` names to `reached`, then those they name, until no new name is left. */
async function reach(
  db: Queryable,
  pending: readonly string[],
  reached: Map<string, PinnedFragment>,
  looked: Set<string>,
  candidate: FragmentCandidate | undefined,
): Promise<void> {
  if (pending.length === 0) return;
  for (const name of pending) looked.add(name);
  const rows = await currentFragments(
    db,
    pending.filter((name) => name !== candidate?.name),
  );
  const found = rows.map(({ name, id, source, references }) => {
    const fragment = { id, source, references };
    reached.set(name, fragment);
    return fragment;
  });
  if (candidate && pending.includes(candidate.name)) {
    reached.set(candidate.name, candidate.fragment);
    found.push(candidate.fragment);
  }
  const next = [...new Set(found.flatMap((fragment) => fragment.references))].filter((name) => !looked.has(name));
  await reach(db, next, reached, looked, candidate);
}

/**
 * The current version of every layout and partial `roots` reach, following each one's own references (KTD7).
 * `candidate` stands in for the current version of its name, for the test renders of a layout or partial being
 * saved. A name with no version is left out, so the render fails to find it.
 */
export async function fragmentClosure(
  db: Queryable,
  roots: readonly string[],
  candidate?: FragmentCandidate,
): Promise<Map<string, PinnedFragment>> {
  const reached = new Map<string, PinnedFragment>();
  await reach(db, [...new Set(roots)], reached, new Set(), candidate);
  return reached;
}

export interface TemplateKey {
  typeKey?: string;
  channel?: Channel;
  language?: string;
}

function templateFilter({ typeKey, channel, language }: TemplateKey): SQL | undefined {
  return and(
    typeKey === undefined ? undefined : eq(templateVersions.typeKey, typeKey),
    channel === undefined ? undefined : eq(templateVersions.channel, channel),
    language === undefined ? undefined : eq(templateVersions.language, language),
  );
}

/** The newest version of each template matching `key` (every template when it is empty). */
export function currentTemplates(db: Queryable, key: TemplateKey = {}): Promise<TemplateRow[]> {
  return db
    .selectDistinctOn([templateVersions.typeKey, templateVersions.channel, templateVersions.language])
    .from(templateVersions)
    .where(templateFilter(key))
    .orderBy(
      asc(templateVersions.typeKey),
      asc(templateVersions.channel),
      asc(templateVersions.language),
      desc(templateVersions.version),
    );
}
