import { eq } from 'drizzle-orm';
import { expect } from 'vitest';

import { notifications } from '../database/schema/index.js';
import type { TestApp } from './app.js';
import { integrationPath, SENDER_SMTP } from './integrations.js';
import { bearer, createSender } from './senders.js';
import type { TestIssuer } from './tokens.js';

export const SEND_PATH = '/api/v1/notifications';

/** A send's audience of one address-only email recipient, with the sender's reference when given. */
export const addressAudience = (address: string, reference?: string) => ({
  kind: 'recipients',
  recipients: [{ kind: 'address', channel: 'email', address, ...(reference ? { reference } : {}) }],
});

/** A sender granted types, with a way to link credentials scoped to some of them. */
export interface SendingSender {
  id: string;
  ownerToken: string;
  /** Links a credential scoped to `typeKeys` and returns its bearer header. */
  credential(clientId: string, typeKeys: readonly string[]): Promise<{ authorization: string }>;
  /** Saves the sender's own email integration (F4), so email policies have a usable integration. */
  overrideEmail(): Promise<void>;
}

export async function sendingSender(
  t: TestApp,
  issuer: TestIssuer,
  adminToken: string,
  name: string,
  types: readonly string[],
): Promise<SendingSender> {
  const sender = await createSender(t, issuer, adminToken, { name, owner: `${name}-owner`, types });
  const owner = bearer(sender.ownerToken);
  const path = `/api/v1/senders/${sender.id}/credentials`;
  return {
    ...sender,
    credential: async (clientId, typeKeys) => {
      const linked = await t.http().post(path).set(owner).send({ clientId });
      expect(linked.status).toBe(201);
      const scoped = await t
        .http()
        .put(`${path}/${String(linked.body.id)}/scopes`)
        .set(owner)
        .send({ typeKeys });
      expect(scoped.status).toBe(200);
      return bearer(await issuer.credentialToken(clientId));
    },
    overrideEmail: async () => {
      const saved = await t.http().put(integrationPath(sender.id, 'email')).set(owner).send(SENDER_SMTP);
      expect(saved.status).toBe(200);
    },
  };
}

/** The sender's stored notifications. */
export const notificationsOf = (t: TestApp, senderId: string) =>
  t.database.db.select().from(notifications).where(eq(notifications.senderId, senderId));
