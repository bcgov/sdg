import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { TypesService } from '../catalog/types.service.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { fragmentVersions, type FragmentKind } from '../database/schema/index.js';
import { referencedNames } from './engines.js';
import { errorMessage } from './render-error.js';
import { DEFAULT_TIME_ZONE } from './render.service.js';
import { currentTemplates, fragmentClosure, type FragmentRow, type PinnedFragment } from './template-store.js';
import type { FragmentVersionResponse } from './templates.schemas.js';
import { fragmentSources, testRender } from './test-render.js';
import { rejected } from './versions.service.js';

function toFragmentVersion(row: FragmentRow): FragmentVersionResponse {
  const { id, kind, name, version, source, references, createdAt } = row;
  return { id, kind, name, version, source, references, createdAt: createdAt.toISOString() };
}

/** The references of a source, or a 400 when it does not parse. */
function referencesOrReject(source: string): string[] {
  try {
    return referencedNames([source]);
  } catch (error) {
    throw rejected('The source does not parse', [errorMessage(error)]);
  }
}

/** The admin's shared layouts and partials (R22), versioned like templates (KTD7). */
@Injectable()
export class FragmentsService {
  private readonly db: NotificationDatabase;
  private readonly types: TypesService;
  private readonly defaultTimeZone: string;

  constructor(
    @InjectDatabase() db: NotificationDatabase,
    @Inject(TypesService) types: TypesService,
    @Inject(DEFAULT_TIME_ZONE) defaultTimeZone: string,
  ) {
    this.db = db;
    this.types = types;
    this.defaultTimeZone = defaultTimeZone;
  }

  /**
   * Saves the next version of a layout or partial. Every current template that reaches it is test-rendered with the
   * new version first, since the next send pins it (R23); 400 with the failures, 409 when the name is the other
   * kind's or another save took the version number first.
   */
  async save(kind: FragmentKind, name: string, source: string): Promise<FragmentVersionResponse> {
    const references = referencesOrReject(source);
    const [existing] = await this.db
      .select({ kind: fragmentVersions.kind })
      .from(fragmentVersions)
      .where(eq(fragmentVersions.name, name))
      .limit(1);
    if (existing && existing.kind !== kind) throw new ConflictException(`${name} is already a ${existing.kind}`);
    const errors = await this.testDependents(name, { id: 'candidate', source, references });
    if (errors.length > 0) throw rejected(`Templates using ${name} failed their test renders`, errors);

    const next = sql<number>`(select coalesce(max(${fragmentVersions.version}), 0) + 1 from ${fragmentVersions}
      where ${eq(fragmentVersions.name, name)})`;
    const [row] = await this.db
      .insert(fragmentVersions)
      .values({ kind, name, version: next, source, references })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException(`Another version of ${name} was saved at the same time; try again`);
    return toFragmentVersion(row);
  }

  /** Test-renders each current template whose layouts and partials would include `fragment` as `name`. */
  private async testDependents(name: string, fragment: PinnedFragment): Promise<string[]> {
    const [templates, types] = await Promise.all([currentTemplates(this.db), this.types.list()]);
    const contracts = new Map(types.map((type) => [type.key, type.dataContract]));
    const results = await Promise.all(
      templates.map(async (template) => {
        const closure = await fragmentClosure(this.db, template.references, { name, fragment });
        const contract = contracts.get(template.typeKey);
        if (!closure.has(name) || !contract) return [];
        const errors = await testRender({
          ...template,
          contract,
          fragments: fragmentSources(closure),
          timeZone: this.defaultTimeZone,
        });
        const label = `${template.typeKey} ${template.channel} ${template.language} v${template.version}`;
        return errors.map((error) => `${label}: ${error}`);
      }),
    );
    return results.flat();
  }

  /** The current version of each layout or partial of `kind`, by name. */
  async listCurrent(kind: FragmentKind): Promise<FragmentVersionResponse[]> {
    const rows = await this.db
      .selectDistinctOn([fragmentVersions.name])
      .from(fragmentVersions)
      .where(eq(fragmentVersions.kind, kind))
      .orderBy(asc(fragmentVersions.name), desc(fragmentVersions.version));
    return rows.map(toFragmentVersion);
  }

  /** Every version of one, newest first; 404 when there is none of `kind`. */
  async versions(kind: FragmentKind, name: string): Promise<FragmentVersionResponse[]> {
    const rows = await this.db
      .select()
      .from(fragmentVersions)
      .where(eq(fragmentVersions.name, name))
      .orderBy(desc(fragmentVersions.version));
    if (rows.length === 0 || rows[0]?.kind !== kind) throw new NotFoundException();
    return rows.map(toFragmentVersion);
  }
}
