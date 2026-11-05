// F5 (sender credential setup), F2 (public form follow-up) and F4 (sender brings its own email integration).
import { Client } from 'pg';
import { z } from 'zod';

import { TYPE_KEYS } from '../lib/catalog.ts';
import { requiredEnv } from '../lib/env.ts';
import { expectBody, expectStatus } from '../lib/http.ts';
import type { E2eContext } from './context.ts';
import { deliveryOn, historyIds, send, settled, to } from './notifications.ts';
import { check, waitFor } from './support.ts';

const credentialListSchema = z.array(z.object({ id: z.uuid(), scopedTypes: z.array(z.string()) }));
const senderSchema = z.object({ grantedTypes: z.array(z.string()) });

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item) => b.includes(item));

/** F5: two linked credentials, one scoped to a single type; a send of another type through it is rejected. */
export async function senderCredentialSetup(ctx: E2eContext): Promise<void> {
  const { senderId, credentials } = ctx.seeded;
  const [listReply, senderReply] = await Promise.all([
    ctx.notify.admin.call('GET', `/api/v1/senders/${senderId}/credentials`),
    ctx.notify.admin.call('GET', `/api/v1/senders/${senderId}`),
  ]);
  const linked = expectBody(listReply, 'Listing credentials', credentialListSchema);
  const sender = expectBody(senderReply, 'Reading the sender', senderSchema);
  check(sameSet(sender.grantedTypes, Object.values(TYPE_KEYS)), `Granted types are ${sender.grantedTypes.join(', ')}`);
  check(linked.length === 2, `Expected 2 linked credentials, found ${linked.length}`);
  const scoped = linked.find((credential) => credential.id === credentials.b.id);
  check(
    sameSet(scoped?.scopedTypes ?? [], [TYPE_KEYS.formReceived]),
    'Credential B is not scoped to form-received only',
  );

  const address = { kind: 'address', channel: 'email', address: `f5-${ctx.run}@example.test` } as const;
  const rejected = await ctx.notify.b.call('POST', '/api/v1/notifications', {
    type: TYPE_KEYS.permitStatus,
    data: { permitNumber: `F5-${ctx.run}`, status: 'issued' },
    idempotencyKey: `f5-rejected-${ctx.run}`,
    audience: to(address),
  });
  expectStatus(rejected, 'A send of an unscoped type through credential B', [403]);
  await send(ctx.notify.b, {
    type: TYPE_KEYS.formReceived,
    data: { formReference: `F5-${ctx.run}` },
    idempotencyKey: `f5-accepted-${ctx.run}`,
    audience: to(address),
  });
}

/** F2: a raw address gets the email in the language the sender gave, and history finds it by address and reference. */
export async function publicFormFollowUp(ctx: E2eContext): Promise<void> {
  const address = `f2-${ctx.run}@example.test`;
  const reference = `form-${ctx.run}`;
  const notificationId = await send(ctx.notify.b, {
    type: TYPE_KEYS.formReceived,
    data: { formReference: reference },
    idempotencyKey: `f2-${ctx.run}`,
    audience: to({ kind: 'address', channel: 'email', address, language: 'fr-CA', reference }),
  });
  const [mail] = await waitFor(`the F2 email to ${address}`, async () => {
    const found = await ctx.mailpit.messagesTo(address);
    return found.length > 0 ? found : undefined;
  });
  check(mail?.Subject === `Nous avons reçu votre formulaire ${reference}`, `F2 subject was "${mail?.Subject}" (fr-CA)`);
  const found = await settled(ctx.notify.b, notificationId);
  const delivery = deliveryOn(found, 'email', address);
  check(delivery.status === 'delivered', `F2 email delivery is ${delivery.status}`);
  check(delivery.attempts.at(-1)?.integrationId === 'platform:email', 'F2 did not use the platform default email');
  const [byAddress, byReference] = await Promise.all([
    historyIds(ctx.notify.b, { address }),
    historyIds(ctx.notify.b, { reference }),
  ]);
  check(byAddress.includes(notificationId), 'History by address does not find the F2 notification');
  check(byReference.includes(notificationId), 'History by reference does not find the F2 notification');
}

const integrationSchema = z.object({
  id: z.uuid(),
  config: z.record(z.string(), z.unknown()),
  secretFieldsSet: z.array(z.string()),
});

/** The stored integration row's config as text, to show the password is not in it (R48). */
async function storedConfig(integrationId: string): Promise<string> {
  const client = new Client({ connectionString: requiredEnv('DATABASE_URL') });
  await client.connect();
  try {
    const result = await client.query<{ config: string }>(
      'select config::text as config from sender_integrations where id = $1',
      [integrationId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`No stored integration ${integrationId}`);
    return row.config;
  } finally {
    await client.end();
  }
}

/** F4: the owner's smtp integration is validated, its password stored sealed, and the sender's email uses it. */
export async function senderEmailIntegration(ctx: E2eContext): Promise<void> {
  const { senderId } = ctx.seeded;
  const password = `f4-${ctx.run}-${crypto.randomUUID()}`;
  const from = 'permits-office@sdg.localhost';
  const path = `/api/v1/senders/${senderId}/integrations/email`;
  const invalid = await ctx.notify.admin.call('PUT', path, { type: 'smtp', config: { host: 'mailpit', from: 'nope' } });
  expectStatus(invalid, 'An smtp integration with an invalid from address', [400]);
  const config = { host: 'mailpit', port: 1025, secure: false, user: 'permits-office', password, from };
  const saved = expectBody(
    await ctx.notify.admin.call('PUT', path, { type: 'smtp', config }),
    'Saving smtp',
    integrationSchema,
  );
  check(saved.secretFieldsSet.includes('password') && !('password' in saved.config), 'The password came back');
  check(!(await storedConfig(saved.id)).includes(password), 'The stored integration holds the password in clear');

  const address = `f4-${ctx.run}@example.test`;
  const notificationId = await send(ctx.notify.a, {
    type: TYPE_KEYS.formReceived,
    data: { formReference: `F4-${ctx.run}` },
    idempotencyKey: `f4-${ctx.run}`,
    audience: to({ kind: 'address', channel: 'email', address }),
  });
  const [mail] = await waitFor(`the F4 email to ${address}`, async () => {
    const found = await ctx.mailpit.messagesTo(address);
    return found.length > 0 ? found : undefined;
  });
  check(mail?.From.Address === from, `F4 email came from ${mail?.From.Address}, not the sender's integration`);
  const delivery = deliveryOn(await settled(ctx.notify.a, notificationId), 'email', address);
  check(delivery.attempts.at(-1)?.integrationId === saved.id, 'F4 history does not record the sender integration');
}
