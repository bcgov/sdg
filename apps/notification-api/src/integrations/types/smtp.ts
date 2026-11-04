import { createTransport } from 'nodemailer';
import { z } from 'zod';

import { OUTBOUND_TIMEOUT_MS, type HostVetter } from '../../outbound/outbound-guard.js';
import { ACCEPTED, failed, failedFromError, type SendOutcome } from '../../outbound/outcome.js';
import { guardedSmtpOptions } from '../../outbound/smtp-connector.js';
import { defineIntegrationType } from '../integration-type.js';

export const smtpConfigSchema = z
  .strictObject({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535).default(587),
    /** true: implicit TLS; false: STARTTLS, which is required (KTD12). */
    secure: z.boolean().default(false),
    user: z.string().min(1).optional(),
    password: z.string().min(1).optional().meta({ description: 'Secret: stored encrypted and never returned' }),
    /** The envelope and header sender; its domain is the Message-ID's right-hand side. */
    from: z.email(),
  })
  .refine((config) => (config.user === undefined) === (config.password === undefined), {
    message: 'user and password are set together',
    path: ['password'],
  });
export type SmtpConfig = z.output<typeof smtpConfigSchema>;

/** The spike's email integration (R45). */
export const smtpIntegration = defineIntegrationType({
  key: 'smtp',
  channel: 'email',
  configSchema: smtpConfigSchema,
  secretFields: ['password'],
});

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The delivery's stable ID, sent as the Message-ID so receivers can discard repeats (R53). */
  messageId: string;
}

export interface SendEmailOptions {
  /** The total time the send may take, from connecting to the server's reply to the message. */
  timeoutMs?: number;
}

/** Codes that mean the configuration or the destination is wrong: retrying won't help. */
const PERMANENT_CODES = new Set(['ETLS', 'EAUTH', 'EENVELOPE', 'EMESSAGE']);

function classify(error: unknown): SendOutcome {
  const outcome = failedFromError(error);
  if (!(error instanceof Error) || !outcome.retryable) return outcome;
  const code: unknown = Reflect.get(error, 'code');
  const permanent: unknown = Reflect.get(error, 'permanent');
  const retryable = !(typeof code === 'string' && PERMANENT_CODES.has(code)) && permanent !== true;
  return failed(retryable, outcome.error);
}

/** Sends one email through the guarded connector (KTD12), with one total timeout over the whole exchange. */
export async function sendEmail(
  guard: HostVetter,
  config: SmtpConfig,
  message: EmailMessage,
  { timeoutMs = OUTBOUND_TIMEOUT_MS }: SendEmailOptions = {},
): Promise<SendOutcome> {
  let timer: NodeJS.Timeout | undefined;
  let transport: ReturnType<typeof createTransport> | undefined;
  let finished = false;
  const timedOut = new Promise<SendOutcome>((resolve) => {
    timer = setTimeout(() => resolve(failed(true, `Timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  const send = async (): Promise<SendOutcome> => {
    const options = await guardedSmtpOptions(guard, config, timeoutMs);
    // The total timeout fired while the host was being vetted: don't connect at all.
    if (finished) return failed(true, `Timed out after ${timeoutMs} ms`);
    transport = createTransport(options);
    const domain = config.from.slice(config.from.lastIndexOf('@') + 1);
    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: `<${message.messageId}@${domain}>`,
    });
    return ACCEPTED;
  };
  try {
    return await Promise.race([send().catch(classify), timedOut]);
  } finally {
    finished = true;
    clearTimeout(timer);
    transport?.close();
  }
}
