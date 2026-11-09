// scripts/e2e.ts's setup: resets the `notification` database, seeds it, gets the credential tokens and prepares the
// portal user's recipient: the person signed in at https://sdg.localhost (BC Services Card), who is not the admin
// (IDIR). Sends address that person by the issuer + subject the relay recorded, read back from the database.
import { runMigrations } from '@repo/notification-database';
import { Client, escapeIdentifier } from 'pg';
import { z } from 'zod';

import { baseUrl, optionalEnv, requiredEnv } from '../lib/env.ts';
import { api, bearer, cookie, expectBody, expectStatus, idSchema, type Api } from '../lib/http.ts';
import { clientCredentialsToken } from '../lib/tokens.ts';
import { seed, seedConfigFromEnv, type Person, type Seeded } from '../seed.ts';
import { mailpit, webhookReceiver, type Mailpit, type WebhookReceiver } from './catchers.ts';

/** F1's email step delay in e2e: short, so the unread case finishes in about a minute. */
export const ESCALATION_DELAY_MINUTES = 1;

export interface E2eContext {
  /** A suffix that makes this run's addresses, references and receiver paths unique. */
  run: string;
  /** notification-api as the admin (also the sender's owner) and as credentials A and B. */
  notify: { admin: Api; a: Api; b: Api };
  /** portal-api's relay (https://sdg.localhost) with the portal session. */
  portal: Api;
  /** The portal session's Cookie header, for calls the JSON client can't make (the relayed live stream). */
  portalCookie: string;
  /** Base URLs: the portal (PORTAL_URL) and notification-api (NOTIFICATION_API_BASE_URL). */
  urls: { portal: string; notify: string };
  seeded: Seeded;
  /** The portal user (the relayed session's person), whom the relayed flows send to. */
  me: Person;
  /** The portal user's verified email from the IdP. */
  idpEmail: string;
  mailpit: Mailpit;
  receiver: WebhookReceiver;
  /** The receiver as notification-api reaches it inside the compose network. */
  receiverInternalUrl: string;
  /** The compose command, e.g. `podman compose`, for the second worker. */
  compose: string[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Drops the database DATABASE_URL names, then recreates and migrates it with @repo/notification-database's
 * runMigrations (build the package first). Only ever on a local server.
 */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('e2e drops the notification database: DATABASE_URL must point at localhost (the compose Postgres)');
  }
  const maintenance = new URL(url.href);
  maintenance.pathname = '/postgres';
  const name = escapeIdentifier(decodeURIComponent(url.pathname.slice(1)));
  const admin = new Client({ connectionString: maintenance.href });
  await admin.connect();
  try {
    // FORCE ends the running notification-api's connections; its pool reconnects once the database is back.
    await admin.query(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.end();
  }
  await runMigrations(databaseUrl);
}

const pointSchema = z.object({ address: z.string(), verified: z.boolean(), source: z.string() });

const userRowSchema = z.object({ issuer: z.string().min(1), subject: z.string().min(1) });

/**
 * The issuer + subject of a user recipient. The relay's API names the recipient only by id, and portal-api's session
 * keeps the subject to itself, so this reads it from the local database (which e2e has just reset and owns).
 */
async function userRecipient(databaseUrl: string, recipientId: string): Promise<Person> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select issuer, subject from notification.recipients where id = $1 and kind = 'user'`,
      [recipientId],
    );
    const [row] = rows;
    if (row === undefined) throw new Error(`The portal user's recipient ${recipientId} is not a user recipient`);
    return userRowSchema.parse(row);
  } finally {
    await client.end();
  }
}

interface PortalRecipient {
  me: Person;
  /** The portal user's verified email from the IdP. */
  idpEmail: string;
}

/**
 * Creates or claims the portal user's recipient (F3), with email on and no quiet hours; returns who that is and their
 * IdP email.
 */
async function preparePortalRecipient(portal: Api, databaseUrl: string): Promise<PortalRecipient> {
  const settings = await portal.call('GET', '/api/v1/notifications');
  if (settings.status === 401) {
    throw new Error(
      'PORTAL_SESSION_COOKIE is missing or expired: sign in at https://sdg.localhost and copy portal.sid',
    );
  }
  if (settings.status === 404) throw new Error('portal-api has no notification relay: is NOTIFICATION_API_URL set?');
  const { id } = expectBody(settings, 'Reading the recipient settings through the portal', idSchema);
  const [me, quiet, email] = await Promise.all([
    userRecipient(databaseUrl, id),
    portal.call('PATCH', '/api/v1/notifications', { quietHours: null }),
    portal.call('PUT', '/api/v1/notifications/channels/email', { enabled: true }),
  ]);
  expectStatus(quiet, 'Clearing quiet hours');
  expectStatus(email, 'Switching email on');
  const reply = await portal.call('GET', '/api/v1/notifications/contact-points');
  const points = expectBody(reply, 'Listing contact points', z.array(pointSchema));
  const idp = points.find((point) => point.source === 'idp' && point.verified);
  if (!idp) throw new Error('The portal user has no verified IdP email contact point, which F1 needs');
  return { me, idpEmail: idp.address };
}

function sessionCookie(): string {
  const raw = requiredEnv('PORTAL_SESSION_COOKIE');
  return raw.startsWith('portal.sid=') ? raw : `portal.sid=${raw}`;
}

/** Everything the flows need, from a freshly reset and seeded database. */
export async function setUp(): Promise<E2eContext> {
  const issuer = requiredEnv('KEYCLOAK_ISSUER_URL');
  const credential = (name: 'A' | 'B') =>
    clientCredentialsToken(
      issuer,
      requiredEnv(`SENDER_CREDENTIAL_${name}_CLIENT_ID`),
      requiredEnv(`SENDER_CREDENTIAL_${name}_CLIENT_SECRET`),
    );
  const [config, tokenA, tokenB] = await Promise.all([
    seedConfigFromEnv(ESCALATION_DELAY_MINUTES),
    credential('A'),
    credential('B'),
  ]);
  const databaseUrl = requiredEnv('DATABASE_URL');
  await resetDatabase(databaseUrl);
  const seeded = await seed(config);
  const portalUrl = baseUrl(optionalEnv('PORTAL_URL', 'https://sdg.localhost'));
  const portalCookie = sessionCookie();
  const portal = api(portalUrl, cookie(portalCookie));
  const { me, idpEmail } = await preparePortalRecipient(portal, databaseUrl);
  return {
    run: Date.now().toString(36),
    notify: {
      admin: api(config.notifyUrl, bearer(config.admin)),
      a: api(config.notifyUrl, bearer(tokenA)),
      b: api(config.notifyUrl, bearer(tokenB)),
    },
    portal,
    portalCookie,
    urls: { portal: portalUrl, notify: config.notifyUrl },
    seeded,
    me,
    idpEmail,
    mailpit: mailpit(baseUrl(optionalEnv('MAILPIT_URL', 'http://localhost:8025'))),
    receiver: webhookReceiver(baseUrl(optionalEnv('WEBHOOK_RECEIVER_URL', 'http://localhost:8090'))),
    receiverInternalUrl: baseUrl(optionalEnv('WEBHOOK_RECEIVER_INTERNAL_URL', 'http://webhook-receiver:8080')),
    compose: optionalEnv('E2E_COMPOSE', 'podman compose').split(/\s+/),
  };
}
