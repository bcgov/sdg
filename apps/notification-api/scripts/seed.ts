// `pnpm --filter notification-api seed`: sets up a notification-api's catalog through the admin and owner API, locally
// or in a deployed environment: three types (scripts/lib/catalog.ts) with in-app, email and webhook templates in en-CA
// and fr-CA, a self-subscribe platform topic, a sender owned by the signed-in admin that may broadcast to that topic and
// is granted all three types, two linked credentials (the first scoped to all three, the second to `form-received`
// only) and, when WEBHOOK_RECEIVER_INTERNAL_URL is set, a failure callback to the webhook receiver. Email uses the
// platform default (compose's DEFAULT_SMTP_* → Mailpit locally); no sender integration is set.
// Re-runnable: each step finds what is there and creates only what is missing (scripts/lib/seed-steps.ts), so a
// failed run is finished by running it again and a run after a full seed changes nothing. The sender is found among
// the platform topic's broadcasters by name.
//
// Reads apps/notification-api/.env (the process env wins):
//   NOTIFICATION_API_BASE_URL       default https://notify.sdg.localhost (Caddy; `pnpm stack:trust` once); a deployed
//                                   environment's is https://<release>-notify.apps.<cluster domain>
//   NOTIFICATION_ADMIN_TOKEN        an admin's token from login.ts; when unset, signs in through the browser (login.ts)
//   SENDER_CREDENTIAL_A_CLIENT_ID   a Keycloak service-account client to link as the sender's first credential
//   SENDER_CREDENTIAL_B_CLIENT_ID   a second one, scoped to `form-received`
//   WEBHOOK_RECEIVER_INTERNAL_URL   optional: the receiver as notification-api reaches it (compose:
//                                   http://webhook-receiver:8080). Unset: no failure callback.
//   plus login.ts's variables when NOTIFICATION_ADMIN_TOKEN is unset.
// Prints the base URL and the admin's issuer first (stderr), then the ids (never a token or secret).
// Exit code 0: seeded. 1: any call failed.
import { seedTypes } from './lib/catalog.ts';
import { baseUrl, exitWithError, loadAppEnv, optionalEnv, printTarget, requiredEnv } from './lib/env.ts';
import { api, bearer } from './lib/http.ts';
import {
  ensureCallback,
  ensureCredentials,
  ensurePlatformTopic,
  ensureSender,
  ensureTypes,
  type Credential,
  type Person,
} from './lib/seed-steps.ts';
import { personOf, staticToken, type TokenSource } from './lib/tokens.ts';
import { login } from './login.ts';

export type { Credential, Person } from './lib/seed-steps.ts';

export interface SeedConfig {
  /** notification-api's base URL, e.g. https://notify.sdg.localhost. */
  notifyUrl: string;
  admin: TokenSource;
  credentialClientIds: readonly [string, string];
  /** The failure callback's URL; none is set when undefined. */
  callbackUrl?: string | undefined;
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

export async function seed(config: SeedConfig): Promise<Seeded> {
  const admin = api(config.notifyUrl, bearer(config.admin));
  const person = personOf(await config.admin.token());
  printTarget('seed', config.notifyUrl, person.issuer);
  await ensureTypes(admin, seedTypes(config.escalationDelayMinutes));
  const topic = await ensurePlatformTopic(admin);
  const sender = await ensureSender(admin, topic, person);
  const { callbackUrl } = config;
  const [credentials] = await Promise.all([
    ensureCredentials(admin, sender.id, config.credentialClientIds),
    callbackUrl === undefined ? undefined : ensureCallback(admin, sender, callbackUrl),
  ]);
  return { senderId: sender.id, admin: person, credentials, platformTopicId: topic.id };
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
  const receiver = optionalEnv('WEBHOOK_RECEIVER_INTERNAL_URL');
  return {
    notifyUrl: baseUrl(optionalEnv('NOTIFICATION_API_BASE_URL', 'https://notify.sdg.localhost')),
    admin: await adminToken(),
    credentialClientIds,
    callbackUrl: receiver === undefined ? undefined : `${baseUrl(receiver)}/callbacks`,
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
