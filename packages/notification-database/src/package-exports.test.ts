import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '../package.json' with { type: 'json' };
import { migrationsFolder, notifications, notificationSchema } from './index.js';
import * as schemaEntry from './schema/index.js';
import * as testingEntry from './testing/index.js';

describe('notification-database package', () => {
  describe('package.json', () => {
    it('exposes only the ., ./schema and ./testing subpaths, each from dist', () => {
      expect(Object.keys(manifest.exports).toSorted()).toEqual(['.', './schema', './testing']);
      expect(manifest.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
      expect(manifest.exports['./schema']).toEqual({
        types: './dist/schema/index.d.ts',
        import: './dist/schema/index.js',
      });
      expect(manifest.exports['./testing']).toEqual({
        types: './dist/testing/index.d.ts',
        import: './dist/testing/index.js',
      });
      expect(Object.keys(testingEntry)).toEqual(['migrateTestDatabase']);
    });

    it('peers drizzle-orm, depends on it and pg via the catalog, and ships the migrations', () => {
      // drizzle-orm is also a dependency so the migrate entry runs from a --prod deploy (the image).
      expect(manifest.peerDependencies).toEqual({ 'drizzle-orm': 'catalog:' });
      expect(manifest.dependencies).toEqual({ 'drizzle-orm': 'catalog:', pg: 'catalog:' });
      expect(manifest.files).toEqual(['dist', 'migrations']);
    });
  });

  describe('schema entry', () => {
    it('exports the notification pgSchema, its tables and the status constants', () => {
      expect(notificationSchema.schemaName).toBe('notification');
      expect(schemaEntry.notifications).toBe(notifications);
      expect(Object.keys(schemaEntry).toSorted()).toEqual([
        'AUDIENCE_KINDS',
        'DELIVERY_STATUSES',
        'IDEMPOTENCY_WINDOW_HOURS',
        'NOTIFICATION_SCHEMA',
        'NOTIFICATION_STATUSES',
        'confirmationSends',
        'contactPoints',
        'credentialTypeScopes',
        'credentials',
        'deliveries',
        'deliveryAttempts',
        'failureCallbacks',
        'fragmentVersions',
        'idempotencyKeys',
        'inboxItems',
        'notificationRecipients',
        'notificationSchema',
        'notificationTypes',
        'notifications',
        'recipientRegistrations',
        'recipients',
        'senderIntegrations',
        'senderOwners',
        'senderTypeGrants',
        'senders',
        'templateVersions',
        'topicBroadcastGrants',
        'topicSubscriptions',
        'topics',
        'verificationTokens',
      ]);
    });
  });

  describe('migrationsFolder', () => {
    it('points at the committed drizzle-kit migrations', () => {
      expect(migrationsFolder).toMatch(/notification-database[\\/]migrations$/);
      expect(existsSync(join(migrationsFolder, 'meta/_journal.json'))).toBe(true);
      expect(existsSync(join(migrationsFolder, '0000_init.sql'))).toBe(true);
    });
  });
});
