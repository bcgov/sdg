import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { TypeResponse } from '../catalog/catalog.schemas.js';
import { sampleData } from '../catalog/data-contract.js';
import { TypesService } from '../catalog/types.service.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { templateVersions } from '../database/schema/index.js';
import { badRequest } from '../http/bad-request.js';
import { TemplateRenderError } from './render-error.js';
import { DEFAULT_TIME_ZONE } from './render.service.js';
import { renderParts } from './renderer.js';
import { currentTemplates, fragmentClosure, type TemplateRow } from './template-store.js';
import {
  partsSchema,
  type PreviewQuery,
  type PreviewResponse,
  type TemplateParams,
  type TemplateVersionResponse,
} from './templates.schemas.js';
import { fragmentSources, SAMPLE_RECIPIENT_ID, templateReferences, testRender } from './test-render.js';

export function toTemplateVersion(row: TemplateRow): TemplateVersionResponse {
  const { id, typeKey, channel, language, version, parts, references, createdAt } = row;
  return { id, typeKey, channel, language, version, parts, references, createdAt: createdAt.toISOString() };
}

/** The references of parts, or a 400 when a part does not parse. */
export function referencesOrReject(params: TemplateParams, parts: Record<string, string>): string[] {
  try {
    return templateReferences(params.channel, parts);
  } catch (error) {
    if (error instanceof TemplateRenderError) throw badRequest('The template does not parse', [error.message]);
    throw error;
  }
}

/** The admin's versioned templates per type, channel and language (R21–R23, R25). */
@Injectable()
export class VersionsService {
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
   * Saves the next version after test-rendering it twice against the type's contract (R23); 400 with the problems
   * when it fails, 409 when another save of the same template took the version number first.
   */
  async save(params: TemplateParams, rawParts: Record<string, string>): Promise<TemplateVersionResponse> {
    const type = await this.type(params.typeKey);
    const parsed = partsSchema(params.channel).safeParse(rawParts);
    if (!parsed.success) {
      throw badRequest(
        `Not the ${params.channel} channel's parts`,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || 'parts'}: ${issue.message}`),
      );
    }
    const parts = parsed.data;
    const references = referencesOrReject(params, parts);
    const fragments = fragmentSources(await fragmentClosure(this.db, references));
    const errors = await testRender({
      ...params,
      contract: type.dataContract,
      parts,
      fragments,
      timeZone: this.defaultTimeZone,
    });
    if (errors.length > 0) throw badRequest('The template failed its test renders', errors);
    return this.insert(params, parts, references);
  }

  private async insert(
    { typeKey, channel, language }: TemplateParams,
    parts: Record<string, string>,
    references: string[],
  ): Promise<TemplateVersionResponse> {
    const next = sql<number>`(select coalesce(max(${templateVersions.version}), 0) + 1 from ${templateVersions}
      where ${and(
        eq(templateVersions.typeKey, typeKey),
        eq(templateVersions.channel, channel),
        eq(templateVersions.language, language),
      )})`;
    const [row] = await this.db
      .insert(templateVersions)
      .values({ typeKey, channel, language, version: next, parts, references })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('Another version of this template was saved at the same time; try again');
    return toTemplateVersion(row);
  }

  /** The current version of each of the type's templates. */
  async listCurrent(typeKey: string): Promise<TemplateVersionResponse[]> {
    await this.type(typeKey);
    return (await currentTemplates(this.db, { typeKey })).map(toTemplateVersion);
  }

  /** Every version of a template, newest first; 404 when it has none. */
  async versions({ typeKey, channel, language }: TemplateParams): Promise<TemplateVersionResponse[]> {
    const rows = await this.db
      .select()
      .from(templateVersions)
      .where(
        and(
          eq(templateVersions.typeKey, typeKey),
          eq(templateVersions.channel, channel),
          eq(templateVersions.language, language),
        ),
      )
      .orderBy(desc(templateVersions.version));
    if (rows.length === 0) throw new NotFoundException();
    return rows.map(toTemplateVersion);
  }

  /** One version, or the current one; 404 when there is none. */
  async version(params: TemplateParams, version?: number): Promise<TemplateVersionResponse> {
    const versions = await this.versions(params);
    const found = version === undefined ? versions[0] : versions.find((candidate) => candidate.version === version);
    if (!found) throw new NotFoundException();
    return found;
  }

  /** Renders a version in its language with sample data for every field (R23). */
  async preview(params: TemplateParams, query: PreviewQuery): Promise<PreviewResponse> {
    const [type, template] = await Promise.all([this.type(params.typeKey), this.version(params, query.version)]);
    const fragments = fragmentSources(await fragmentClosure(this.db, template.references));
    try {
      const rendered = await renderParts({
        channel: params.channel,
        parts: template.parts,
        fragments,
        locale: { language: template.language, timeZone: query.timeZone ?? this.defaultTimeZone },
        data: sampleData(type.dataContract),
        envelope: { type: type.key, recipientId: SAMPLE_RECIPIENT_ID },
        strict: false,
      });
      return { version: template.version, language: template.language, rendered };
    } catch (error) {
      if (error instanceof TemplateRenderError) throw badRequest('The template did not render', [error.message]);
      throw error;
    }
  }

  private async type(typeKey: string): Promise<TypeResponse> {
    const type = await this.types.find(typeKey);
    if (!type) throw new NotFoundException('No such Notification type');
    return type;
  }
}
