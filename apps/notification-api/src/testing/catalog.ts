import { expect } from 'vitest';

import type { TestApp } from './app.js';
import { bearer } from './senders.js';

/** A minimal Notification type definition: one required string field, email all at once. */
export function typeDefinition(key: string): Record<string, unknown> {
  return {
    key,
    displayName: key,
    dataContract: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
    defaultLanguage: 'en-CA',
    policy: { mode: 'all-at-once', channels: ['email'] },
  };
}

/** Defines each type through the admin API, leaving any that already exist as they are. */
export async function ensureTypes(t: TestApp, adminToken: string, keys: readonly string[]): Promise<void> {
  const created = await Promise.all(
    keys.map((key) => t.http().post('/api/v1/admin/types').set(bearer(adminToken)).send(typeDefinition(key))),
  );
  expect(created.map((res) => res.status).filter((status) => status !== 201 && status !== 409)).toEqual([]);
}
