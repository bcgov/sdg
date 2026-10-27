import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const urlWithProtocol = (protocols: readonly string[]) =>
  z.url().refine((value) => protocols.includes(new URL(value).protocol), {
    message: `Must use ${protocols.map((protocol) => `${protocol}//`).join(' or ')}`,
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_URL: urlWithProtocol(['http:', 'https:']).transform((value) => value.replace(/\/+$/, '')),
  TRUST_PROXY: booleanString,
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(28_800),
  KEYCLOAK_ISSUER_URL: urlWithProtocol(['http:', 'https:']).transform((value) => value.replace(/\/+$/, '')),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
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
