// `pnpm --filter notification-api seed`: fills an empty `notification` database through the admin and owner API:
// the catalog (scripts/lib/catalog.ts: three types with in-app, email and webhook templates in en-CA and fr-CA), a
// sender owned by the signed-in admin and granted all three types, two linked credentials (the first scoped to all
// three, the second to `form-received` only), a failure callback to the webhook receiver and a self-subscribe
// platform topic the sender may broadcast to. Email uses the platform default (compose's DEFAULT_SMTP_* → Mailpit);
// no sender integration is set.
// Refuses to run when the catalog already has the seed's types: scripts/e2e.ts resets the database and seeds it.
//
// Reads apps/notification-api/.env (the process env wins):
//   NOTIFICATION_API_BASE_URL       default https://notify.sdg.localhost (Caddy; `pnpm stack:trust` once)
//   NOTIFICATION_ADMIN_TOKEN        an admin's token from login.ts; when unset, signs in through the browser (login.ts)
//   SENDER_CREDENTIAL_A_CLIENT_ID   a Keycloak service-account client to link as the sender's first credential
//   SENDER_CREDENTIAL_B_CLIENT_ID   a second one, scoped to `form-received`
//   WEBHOOK_RECEIVER_INTERNAL_URL   the receiver as notification-api reaches it, default http://webhook-receiver:8080
//   plus login.ts's variables when NOTIFICATION_ADMIN_TOKEN is unset.
// Prints the ids it created (never a token or secret). Exit code 0: seeded. 1: any call failed.
import { z } from 'zod';

import { PLATFORM_TOPIC, TYPE_KEYS, seedTypes, type SeedType } from './lib/catalog.ts';
import { baseUrl, exitWithError, loadAppEnv, optionalEnv, requiredEnv } from './lib/env.ts';
import { api, bearer, expectBody, expectStatus, idSchema, type Api } from './lib/http.ts';
import { personOf, staticToken, type TokenSource } from './lib/tokens.ts';
import { login } from './login.ts';

export interface Person {
  issuer: string;
  subject: string;
}

export interface SeedConfig {
  /** notification-api's base URL, e.g. https://notify.sdg.localhost. */
  notifyUrl: string;
  admin: TokenSource;
  credentialClientIds: readonly [string, string];
  callbackUrl: string;
  /** F1's email step delay. */
  escalationDelayMinutes: number;
}

export interface Seeded {
  senderId: string;
  /** The signed-in admin, who also owns the sender. */
  admin: Person;
  credentials: { a: Credential; b: Credential };
  platformTopicId: string;
}

const credentialSchema = z.object({ id: z.uuid(), clientId: z.string(), scopedTypes: z.array(z.string()) });
export type Credential = z.infer<typeof credentialSchema>;

/** Stops before creating anything when the admin API refuses the token or the catalog is already seeded. */
async function assertUnseeded(admin: Api): Promise<void> {
  const reply = await admin.call('GET', `/api/v1/admin/types/${TYPE_KEYS.permitApproved}`);
  if (reply.status === 401 || reply.status === 403) {
    throw new Error(`The admin API answered ${reply.status}: the token needs notification-api's admin client role`);
  }
  if (reply.status !== 404) {
    expectStatus(reply, 'Checking the catalog');
    throw new Error('The catalog is already seeded: run against an empty database (scripts/e2e.ts resets it)');
  }
}

async function defineType(admin: Api, { templates, ...definition }: SeedType): Promise<void> {
  expectStatus(await admin.call('POST', '/api/v1/admin/types', definition), `Creating type ${definition.key}`);
  await Promise.all(
    templates.map(async ({ channel, language, parts }) => {
      const path = `/api/v1/admin/types/${definition.key}/templates/${channel}/${language}/versions`;
      expectStatus(await admin.call('POST', path, { parts }), `Saving ${definition.key} ${channel} ${language}`);
    }),
  );
}

async function createSender(admin: Api, owner: Person): Promise<string> {
  const reply = await admin.call('POST', '/api/v1/admin/senders', { name: 'Permits Office' });
  const { id } = expectBody(reply, 'Creating the sender', idSchema);
  const grants = Object.values(TYPE_KEYS).map(async (typeKey) => {
    expectStatus(await admin.call('PUT', `/api/v1/admin/senders/${id}/grants/${typeKey}`), `Granting ${typeKey}`);
  });
  const addOwner = async () => {
    expectStatus(await admin.call('POST', `/api/v1/admin/senders/${id}/owners`, owner), 'Adding the admin as owner');
  };
  await Promise.all([addOwner(), ...grants]);
  return id;
}

/** Links both clients and scopes them (R8): the first to every granted type, the second to `form-received` (F5). */
async function linkCredentials(
  owner: Api,
  senderId: string,
  [clientA, clientB]: readonly [string, string],
): Promise<Seeded['credentials']> {
  const link = async (clientId: string, typeKeys: readonly string[]) => {
    const what = `Linking credential ${clientId}`;
    const reply = await owner.call('POST', `/api/v1/senders/${senderId}/credentials`, { clientId });
    const { id } = expectBody(reply, what, credentialSchema);
    const path = `/api/v1/senders/${senderId}/credentials/${id}/scopes`;
    return expectBody(await owner.call('PUT', path, { typeKeys }), `Scoping ${clientId}`, credentialSchema);
  };
  const [a, b] = await Promise.all([link(clientA, Object.values(TYPE_KEYS)), link(clientB, [TYPE_KEYS.formReceived])]);
  return { a, b };
}

async function createPlatformTopic(admin: Api, senderId: string): Promise<string> {
  const { id } = expectBody(
    await admin.call('POST', '/api/v1/admin/topics', PLATFORM_TOPIC),
    'Creating the topic',
    idSchema,
  );
  const path = `/api/v1/admin/topics/${id}/broadcasters/${senderId}`;
  expectStatus(await admin.call('PUT', path), 'Granting the sender the platform topic');
  return id;
}

export async function seed(config: SeedConfig): Promise<Seeded> {
  const admin = api(config.notifyUrl, bearer(config.admin));
  const person = personOf(await config.admin.token());
  await assertUnseeded(admin);
  await Promise.all(seedTypes(config.escalationDelayMinutes).map((type) => defineType(admin, type)));
  const senderId = await createSender(admin, person);
  const callback = admin.call('PUT', `/api/v1/senders/${senderId}/callback`, { url: config.callbackUrl });
  const [credentials, platformTopicId, callbackReply] = await Promise.all([
    linkCredentials(admin, senderId, config.credentialClientIds),
    createPlatformTopic(admin, senderId),
    callback,
  ]);
  // The reply carries the callback's signing secret; it is not printed.
  expectStatus(callbackReply, 'Setting the failure callback');
  return { senderId, admin: person, credentials, platformTopicId };
}

/** NOTIFICATION_ADMIN_TOKEN when set, otherwise a browser sign-in (login.ts). */
export function adminToken(): Promise<TokenSource> {
  const token = optionalEnv('NOTIFICATION_ADMIN_TOKEN');
  return token === undefined ? login() : Promise.resolve(staticToken(token));
}

/** The seed's settings from the environment. */
export async function seedConfigFromEnv(escalationDelayMinutes: number): Promise<SeedConfig> {
  const credentialClientIds = [
    requiredEnv('SENDER_CREDENTIAL_A_CLIENT_ID'),
    requiredEnv('SENDER_CREDENTIAL_B_CLIENT_ID'),
  ] as const;
  const receiver = baseUrl(optionalEnv('WEBHOOK_RECEIVER_INTERNAL_URL', 'http://webhook-receiver:8080'));
  return {
    notifyUrl: baseUrl(optionalEnv('NOTIFICATION_API_BASE_URL', 'https://notify.sdg.localhost')),
    admin: await adminToken(),
    credentialClientIds,
    callbackUrl: `${receiver}/callbacks`,
    escalationDelayMinutes,
  };
}

if (import.meta.main) {
  process.on('unhandledRejection', exitWithError('seed'));
  loadAppEnv();
  try {
    const seeded = await seed(await seedConfigFromEnv(60));
    console.log(`seed: sender ${seeded.senderId}, platform topic ${seeded.platformTopicId}`);
    console.log(
      `seed: credentials ${seeded.credentials.a.clientId} (all types), ${seeded.credentials.b.clientId} (form-received)`,
    );
  } catch (error) {
    exitWithError('seed')(error);
  }
}
