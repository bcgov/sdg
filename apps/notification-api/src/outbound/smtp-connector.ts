import { isIP } from 'node:net';

import type { SMTPTransportOptions } from 'nodemailer';

import type { HostVetter } from './outbound-guard.js';

export interface SmtpEndpoint {
  host: string;
  port: number;
  /** true: implicit TLS; false: STARTTLS, required unless the host is allow-listed. */
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
}

/**
 * Nodemailer transport options for one guarded SMTP connection (KTD12): the host is vetted and the socket connects to
 * the vetted address; TLS (implicit, or STARTTLS, which is required unless the host is allow-listed) verifies the
 * certificate against the original host name. Connection, greeting and idle-socket timeouts are each bounded by
 * `timeoutMs`; the caller bounds the whole send.
 */
export async function guardedSmtpOptions(
  guard: HostVetter,
  endpoint: SmtpEndpoint,
  timeoutMs: number,
): Promise<SMTPTransportOptions> {
  const vetted = await guard.vet(endpoint.host);
  const servername = isIP(vetted.host) === 0 ? vetted.host : undefined;
  return {
    host: vetted.address,
    port: endpoint.port,
    secure: endpoint.secure,
    requireTLS: !endpoint.secure && !vetted.exempt,
    ...(servername ? { servername } : {}),
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(servername ? { servername } : {}) },
    ...(endpoint.user ? { auth: { user: endpoint.user, pass: endpoint.password ?? '' } } : {}),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}
