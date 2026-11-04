import { expect } from 'vitest';

import type { Channel } from '../channels/channels.js';
import { RenderService, type PinnedTemplates } from '../templates/render.service.js';
import type { TestApp } from './app.js';
import { bearer } from './senders.js';

/** A permit type: a required permit number and expiry, an optional holder name, link and message. */
export function permitType(key: string): Record<string, unknown> {
  return {
    key,
    displayName: key,
    dataContract: {
      type: 'object',
      properties: {
        permit: {
          type: 'object',
          properties: { number: { type: 'string' }, holder: { type: 'string' } },
          required: ['number'],
        },
        expires_at: { type: 'string' },
        link: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['permit', 'expires_at'],
    },
    defaultLanguage: 'en-CA',
    policy: { mode: 'all-at-once', channels: ['email', 'webhook'] },
  };
}

/** MJML around `content`, which must be text for an `mj-text`. */
export const mjml = (content: string): string =>
  `<mjml><mj-body><mj-section><mj-column><mj-text>${content}</mj-text></mj-column></mj-section></mj-body></mjml>`;

/** The admin API for one test file's templates. */
export interface TemplatesApi {
  defineType(definition: Record<string, unknown>): Promise<void>;
  save(typeKey: string, channel: Channel, language: string, parts: Record<string, string>): Promise<SaveResult>;
  saveLayout(name: string, source: string): Promise<SaveResult>;
  savePartial(name: string, source: string): Promise<SaveResult>;
  /** The type's current templates pinned, as a send would at accept. */
  pin(typeKey: string, defaultLanguage?: string): Promise<PinnedTemplates>;
}

export interface SaveResult {
  status: number;
  body: { version?: number; errors?: string[]; message?: string };
}

/** Throws unless the save succeeded, for hooks that set up templates. */
export function ensureSaved(result: SaveResult): void {
  if (result.status !== 201) throw new Error(`Saving failed (${result.status}): ${JSON.stringify(result.body)}`);
}

export function templatesApi(t: TestApp, adminToken: string): TemplatesApi {
  const admin = bearer(adminToken);
  const post = async (path: string, body: object): Promise<SaveResult> => {
    const res = await t.http().post(path).set(admin).send(body);
    return { status: res.status, body: res.body };
  };
  return {
    defineType: async (definition) => {
      const res = await t.http().post('/api/v1/admin/types').set(admin).send(definition);
      expect(res.status).toBe(201);
    },
    save: (typeKey, channel, language, parts) =>
      post(`/api/v1/admin/types/${typeKey}/templates/${channel}/${language}/versions`, { parts }),
    saveLayout: (name, source) => post(`/api/v1/admin/layouts/${name}/versions`, { source }),
    savePartial: (name, source) => post(`/api/v1/admin/partials/${name}/versions`, { source }),
    pin: (typeKey, defaultLanguage = 'en-CA') => t.app.get(RenderService).pin({ key: typeKey, defaultLanguage }),
  };
}
