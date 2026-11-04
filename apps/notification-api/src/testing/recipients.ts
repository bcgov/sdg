import { expect } from 'vitest';

import type { TestApp } from './app.js';
import { bearer, createSender } from './senders.js';
import type { TestSmtpServer } from './smtp-server.js';
import type { TestIssuer } from './tokens.js';

export interface CredentialSender {
  id: string;
  /** A bearer header with the sender's linked credential's client-credentials token. */
  credential: { authorization: string };
}

/** A sender with one linked credential. */
export async function senderWithCredential(
  t: TestApp,
  issuer: TestIssuer,
  adminToken: string,
  name: string,
): Promise<CredentialSender> {
  const sender = await createSender(t, issuer, adminToken, { name, owner: `${name}-owner` });
  const clientId = `${name}-client`;
  const linked = await t
    .http()
    .post(`/api/v1/senders/${sender.id}/credentials`)
    .set(bearer(sender.ownerToken))
    .send({ clientId });
  expect(linked.status).toBe(201);
  return { id: sender.id, credential: bearer(await issuer.credentialToken(clientId)) };
}

/** The platform default email integration pointed at the in-process SMTP server, which the guard allow-lists. */
export function platformSmtpEnv(server: TestSmtpServer): Record<string, string> {
  return {
    DEFAULT_SMTP_HOST: '127.0.0.1',
    DEFAULT_SMTP_PORT: String(server.port),
    DEFAULT_SMTP_SECURE: 'false',
    DEFAULT_SMTP_FROM: 'notify@platform.example.com',
    NOTIFICATION_OUTBOUND_ALLOW_HOSTS: '127.0.0.1',
  };
}

/** A raw message's content with quoted-printable soft line breaks and `=3D` decoded. */
function decodeQuotedPrintable(raw: string): string {
  return raw.replaceAll('=\r\n', '').replaceAll('=3D', '=');
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** Matches a message's `To:` header for the address. */
const toHeader = (address: string): RegExp => new RegExp(`^To: ${address.replaceAll(REGEX_SPECIALS, '\\$&')}$`, 'mi');

const TOKEN_LINK = /https:\/\/portal\.example\.com\/confirm-email\?token=([A-Za-z0-9_-]+)/;

/** The confirmation token in the last message sent to `address`. Throws when there is none. */
export function confirmationToken(server: TestSmtpServer, address: string): string {
  const message = server.messages.findLast((raw) => toHeader(address).test(raw));
  if (!message) throw new Error(`No message was sent to ${address}`);
  const token = TOKEN_LINK.exec(decodeQuotedPrintable(message))?.[1];
  if (!token) throw new Error(`The message to ${address} has no confirmation link`);
  return token;
}

/** How many messages were sent to `address`. */
export function messagesTo(server: TestSmtpServer, address: string): number {
  return server.messages.filter((raw) => toHeader(address).test(raw)).length;
}
