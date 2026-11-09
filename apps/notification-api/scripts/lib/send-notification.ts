// scripts/send.ts's audience flags and its one test notification.
import { parseArgs } from 'node:util';

import { send, to, type Audience } from '../e2e/notifications.ts';
import { TYPE_KEYS } from './catalog.ts';
import type { Api } from './http.ts';

/** The command line can't name an audience; the script prints the usage and exits 1. */
export class UsageError extends Error {}

export const SEND_USAGE = `usage: pnpm --filter notification-api send --topic <topic id>
       pnpm --filter notification-api send --issuer <iss> --subject <sub>
  --topic              a topic the sender may broadcast to, e.g. the platform topic id the seed prints
  --issuer, --subject  one user recipient, as the IdP names them (the token's iss and sub)`;

/** The audience the flags name: a topic, or one user by issuer and subject. Throws UsageError otherwise. */
export function audienceFromArgs(argv: readonly string[]): Audience {
  let values: { topic?: string; issuer?: string; subject?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { topic: { type: 'string' }, issuer: { type: 'string' }, subject: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { topic, issuer, subject } = values;
  const person = issuer !== undefined || subject !== undefined;
  if (topic !== undefined && !person) return { kind: 'topic', topicId: topic };
  if (topic === undefined && issuer !== undefined && subject !== undefined) {
    return to({ kind: 'user', issuer, subject });
  }
  throw new UsageError('Give either --topic, or --issuer with --subject');
}

/** Sends one `permit-status` notification (in-app and email for users, as in e2e's F6) and returns its id. */
export function sendTestNotification(credential: Api, audience: Audience): Promise<string> {
  const run = crypto.randomUUID();
  return send(credential, {
    type: TYPE_KEYS.permitStatus,
    data: { permitNumber: `TEST-${run.slice(0, 8)}`, status: 'sent by the send script' },
    idempotencyKey: `send-${run}`,
    audience,
  });
}
