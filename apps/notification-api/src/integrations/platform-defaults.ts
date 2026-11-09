import { createHash } from 'node:crypto';

import type { Channel } from '@repo/notification-database';

import type { Env } from '../config/env.js';
import type { IntegrationConfig } from './registry.js';
import { smtpConfigSchema } from './types/smtp.js';

/** The integration a delivery attempt uses, and the id and config version it records (KTD9). */
export type ResolvedIntegration = IntegrationConfig & {
  /** A sender override's row id, or `platform:<channel>`. */
  readonly id: string;
  /** Changes whenever the configuration does. */
  readonly version: string;
  readonly source: 'sender' | 'platform';
  readonly channel: Channel;
};

export type PlatformIntegrations = Readonly<Partial<Record<Channel, ResolvedIntegration>>>;

/** Injection token for the platform defaults. */
export const PLATFORM_INTEGRATIONS = Symbol('PLATFORM_INTEGRATIONS');

type SmtpEnv = Pick<
  Env,
  | 'DEFAULT_SMTP_HOST'
  | 'DEFAULT_SMTP_PORT'
  | 'DEFAULT_SMTP_SECURE'
  | 'DEFAULT_SMTP_USER'
  | 'DEFAULT_SMTP_PASSWORD'
  | 'DEFAULT_SMTP_FROM'
>;

/** The env default's version: a hash of its non-secret fields, so the password never leaves the process. */
function versionOf(fields: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('base64url').slice(0, 16);
}

/**
 * A key the env schema left unset. `ConfigService.get` falls back to the raw `process.env` value when the validated
 * value is undefined, so a blank `DEFAULT_SMTP_*=` (as `.env.example` ships) arrives here as `''`, not `undefined`.
 */
function present<T>(value: T | ''): T | undefined {
  return value === '' ? undefined : value;
}

/** The DEFAULT_SMTP_* email integration (R46), or none when DEFAULT_SMTP_HOST is blank. Throws when it is incomplete. */
function emailDefault(env: SmtpEnv): ResolvedIntegration | undefined {
  const host = present(env.DEFAULT_SMTP_HOST);
  if (host === undefined) return undefined;
  const parsed = smtpConfigSchema.safeParse({
    host,
    port: present(env.DEFAULT_SMTP_PORT),
    secure: present(env.DEFAULT_SMTP_SECURE),
    user: present(env.DEFAULT_SMTP_USER),
    password: present(env.DEFAULT_SMTP_PASSWORD),
    from: present(env.DEFAULT_SMTP_FROM),
  });
  if (!parsed.success) {
    // Names the variables, never their values.
    const keys = parsed.error.issues.map(
      (issue) => `DEFAULT_SMTP_${issue.path.join('_').toUpperCase()}: ${issue.message}`,
    );
    throw new Error(`The platform default email integration is invalid:\n  ${keys.join('\n  ')}`);
  }
  const { password: _password, ...nonSecret } = parsed.data;
  return {
    id: 'platform:email',
    version: versionOf(nonSecret),
    source: 'platform',
    channel: 'email',
    type: 'smtp',
    config: parsed.data,
  };
}

/**
 * Each channel's platform default (R46): email from DEFAULT_SMTP_*, when set; webhook and in-app always use their
 * built-in types, which need no configuration.
 */
export function platformIntegrations(env: SmtpEnv): PlatformIntegrations {
  const email = emailDefault(env);
  const builtIn = { version: '1', source: 'platform', config: {} } as const;
  return {
    ...(email ? { email } : {}),
    webhook: { ...builtIn, id: 'platform:webhook', channel: 'webhook', type: 'webhook' },
    'in-app': { ...builtIn, id: 'platform:in-app', channel: 'in-app', type: 'in-app' },
  };
}
