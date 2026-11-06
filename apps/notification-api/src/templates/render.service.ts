import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';

import { canonicalLanguage } from '../catalog/catalog.schemas.js';
import type { Channel } from '../channels/channels.js';
import { InjectDatabase, type NotificationDatabase } from '../database/database.module.js';
import { fragmentVersions, templateVersions, type RecipientKind } from '../database/schema/index.js';
import { renderParts, type RenderedParts } from './renderer.js';
import { currentTemplates, fragmentClosure, type Queryable } from './template-store.js';

/** The platform's default IANA zone (`DEFAULT_TIMEZONE`), for recipients without one (R39). */
export const DEFAULT_TIME_ZONE = Symbol('DEFAULT_TIME_ZONE');

/** The template, layout and partial versions a notification renders with, recorded at accept (KTD7). */
export interface PinnedTemplates {
  typeKey: string;
  /** The type's default language at accept, for recipients whose language has no template (R39). */
  defaultLanguage: string;
  /** Template version ids by channel, then language. A channel the type has no template for is absent (R14). */
  templates: Partial<Record<Channel, Record<string, string>>>;
  /** Layout and partial version ids by name: every one the pinned templates reach. */
  fragments: Record<string, string>;
}

export interface RenderRequest {
  pinned: PinnedTemplates;
  channel: Channel;
  /** The recipient's preferred language; none means the type's default (R39). */
  language?: string | null | undefined;
  /** The recipient's IANA zone; none means the platform default (R39). */
  timeZone?: string | null | undefined;
  /** The notification's data, validated against the type's contract at send. */
  data: Record<string, unknown>;
  /** Named in a webhook's standard envelope. */
  recipientId: string;
  /** Templates see it as `notification.id` (R36). */
  notificationId: string;
  /** Templates see `recipient.hasInbox`, true only for a user (KTD10). */
  recipientKind: RecipientKind;
}

export type RenderResult =
  | { status: 'rendered'; language: string; templateVersionId: string; parts: RenderedParts }
  /** The channel has no template in the recipient's or the default language: the delivery is skipped (R14). */
  | { status: 'no-template' };

/** The recipient's language when the channel has a template in it, else the default language when it has one. */
function chooseLanguage(
  byLanguage: Readonly<Record<string, string>> | undefined,
  preferred: string | null | undefined,
  defaultLanguage: string,
): string | null {
  if (!byLanguage) return null;
  const canonical = preferred ? canonicalLanguage(preferred) : null;
  if (canonical !== null && Object.hasOwn(byLanguage, canonical)) return canonical;
  return Object.hasOwn(byLanguage, defaultLanguage) ? defaultLanguage : null;
}

/**
 * Pins templates at accept and renders them at delivery. A render reads only pinned versions, so a
 * notification renders the same after the admin publishes new ones (R25, AE10).
 */
@Injectable()
export class RenderService {
  private readonly db: NotificationDatabase;
  private readonly defaultTimeZone: string;

  constructor(@InjectDatabase() db: NotificationDatabase, @Inject(DEFAULT_TIME_ZONE) defaultTimeZone: string) {
    this.db = db;
    this.defaultTimeZone = defaultTimeZone;
  }

  /** The current template of every channel and language of the type, and the layouts and partials they reach. */
  async pin(type: { key: string; defaultLanguage: string }, db: Queryable = this.db): Promise<PinnedTemplates> {
    const templates = await currentTemplates(db, { typeKey: type.key });
    const fragments = await fragmentClosure(
      db,
      templates.flatMap((template) => template.references),
    );
    const byChannel: PinnedTemplates['templates'] = {};
    for (const template of templates) {
      byChannel[template.channel] = { ...byChannel[template.channel], [template.language]: template.id };
    }
    return {
      typeKey: type.key,
      defaultLanguage: type.defaultLanguage,
      templates: byChannel,
      fragments: Object.fromEntries([...fragments].map(([name, fragment]) => [name, fragment.id])),
    };
  }

  /** Renders the channel's pinned template for the recipient. Throws a TemplateRenderError when it cannot render. */
  async render(request: RenderRequest): Promise<RenderResult> {
    const { pinned, channel } = request;
    const byLanguage = pinned.templates[channel];
    const language = chooseLanguage(byLanguage, request.language, pinned.defaultLanguage);
    const templateVersionId = language === null ? undefined : byLanguage?.[language];
    if (language === null || templateVersionId === undefined) return { status: 'no-template' };

    const fragmentIds = Object.values(pinned.fragments);
    const [[template], fragments] = await Promise.all([
      this.db.select().from(templateVersions).where(eq(templateVersions.id, templateVersionId)),
      fragmentIds.length === 0
        ? Promise.resolve([])
        : this.db.select().from(fragmentVersions).where(inArray(fragmentVersions.id, fragmentIds)),
    ]);
    // Versions are never deleted, so a missing one is a broken pin rather than a template problem.
    if (!template) throw new Error(`Pinned template version ${templateVersionId} does not exist`);

    const parts = await renderParts({
      channel,
      parts: template.parts,
      fragments: Object.fromEntries(fragments.map((fragment) => [fragment.name, fragment.source])),
      locale: { language, timeZone: request.timeZone ?? this.defaultTimeZone },
      data: request.data,
      variables: {
        notification: { id: request.notificationId },
        recipient: { hasInbox: request.recipientKind === 'user' },
      },
      envelope: { type: pinned.typeKey, recipientId: request.recipientId },
      strict: false,
    });
    return { status: 'rendered', language, templateVersionId, parts };
  }
}
