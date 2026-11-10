import { baseUrl, createEnvValidator, serviceEnvShape, urlWithProtocol } from '@repo/server-core';
import { z } from 'zod';

export const envSchema = z.object({
  ...serviceEnvShape('portal-api'),
  APP_URL: baseUrl(['http:', 'https:']),
  DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).default(28_800),
  KEYCLOAK_ISSUER_URL: baseUrl(['https:']),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  // core-api's in-cluster URL: sign-in upserts the principal there and /api/v<N>/{portal,shared}/… is forwarded to it.
  CORE_API_URL: baseUrl(['http:', 'https:']),
});

export type Env = z.infer<typeof envSchema>;

/** `@nestjs/config` validate hook: parses `process.env` (plus any .env file) into a typed `Env`. */
export const validateEnv: (raw: Record<string, unknown>) => Env = createEnvValidator(envSchema);
