import { z } from 'zod';

import { roleSchema } from '../roles/role.js';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const urlWithProtocol = (protocols: readonly string[]) => {
  const schemes = protocols.map((protocol) => `${protocol}//`).join(' or ');
  return z.url().refine((value) => protocols.includes(new URL(value).protocol), { message: `Must use ${schemes}` });
};

/** Drops trailing slashes with a loop: the equivalent `/\/+$/` backtracks on long runs of slashes. */
const withoutTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
};

/** An unset or blank variable counts as missing, so `FOO=` in a .env file doesn't fail validation. */
const blankAsMissing = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** `a, b,,c` → `['a', 'b', 'c']`; unset or blank → `[]`. */
const commaList = z.preprocess(
  blankAsMissing,
  z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
);

/** A blank or unset key is left undefined. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsMissing, schema.optional());

/** A zone the runtime's Intl data knows, e.g. America/Vancouver. */
export const timeZoneSchema = z.string().refine(
  (value) => {
    try {
      return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone !== '';
    } catch {
      return false;
    }
  },
  { message: 'Must be an IANA time zone, e.g. America/Vancouver' },
);

/**
 * Optional OpenTelemetry settings (doc 20). No OTEL_EXPORTER_OTLP_ENDPOINT means telemetry is not wired up at all.
 * src/instrumentation.ts validates these on its own before Nest starts; envSchema includes them so Nest fails boot on
 * the same invalid values.
 */
export const otelEnvSchema = z.object({
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    blankAsMissing,
    urlWithProtocol(['http:', 'https:']).transform(withoutTrailingSlashes).optional(),
  ),
  OTEL_SERVICE_NAME: z.preprocess(blankAsMissing, z.string().min(1).default('notification-api')),
  OTEL_RESOURCE_ATTRIBUTES: z.preprocess(blankAsMissing, z.string().optional()),
  OTEL_TRACES_SAMPLER_ARG: z.preprocess(blankAsMissing, z.coerce.number().min(0).max(1).default(1)),
});

/** The platform-wide default email integration (R46). Every key is optional: no host means no default. */
export const smtpDefaultEnvSchema = z.object({
  DEFAULT_SMTP_HOST: optional(z.string().min(1)),
  DEFAULT_SMTP_PORT: optional(z.coerce.number().int().min(1).max(65_535)),
  /** true: implicit TLS; false: required STARTTLS (KTD12). */
  DEFAULT_SMTP_SECURE: optional(booleanString),
  DEFAULT_SMTP_USER: optional(z.string().min(1)),
  DEFAULT_SMTP_PASSWORD: optional(z.string().min(1)),
  DEFAULT_SMTP_FROM: optional(z.string().min(1)),
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: booleanString.default(false),
  NOTIFICATION_ROLE: z.preprocess(blankAsMissing, roleSchema),
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
  KEYCLOAK_ISSUER_URL: urlWithProtocol(['https:']).transform(withoutTrailingSlashes),
  /** This service's own client id: the audience it accepts on tokens. */
  NOTIFICATION_CLIENT_ID: z.string().min(1),
  /** Clients (e.g. portal-api) allowed to relay a user's token. */
  RELAYING_CLIENT_IDS: commaList,
  /** At least 32 characters, e.g. `openssl rand -base64 48`. Keys the stored-secret encryption (KTD11). */
  NOTIFICATION_ENCRYPTION_KEY: z.string().min(32),
  /** Hosts exempt from the outbound guard (KTD12), e.g. the local mail catcher. Empty by default. */
  NOTIFICATION_OUTBOUND_ALLOW_HOSTS: commaList,
  DEFAULT_TIMEZONE: z.preprocess(blankAsMissing, timeZoneSchema.default('America/Vancouver')),
  /** portal-web's confirm page (KTD15): confirmation emails link to `<this>?token=…`. */
  CONFIRM_EMAIL_URL: urlWithProtocol(['https:']),
  ...smtpDefaultEnvSchema.shape,
  ...otelEnvSchema.shape,
});

export type Env = z.infer<typeof envSchema>;

/** Thrown for an invalid environment. Lists each key with its problem, never the values. */
export class EnvValidationError extends Error {
  readonly keys: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    super(`Invalid environment:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.keys = issues.map((issue) => issue.path.join('.'));
  }
}

/** `@nestjs/config` validate hook: parses `process.env` (plus any .env file) into a typed `Env`. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) throw new EnvValidationError(result.error.issues);
  return result.data;
}
