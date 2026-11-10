import { baseUrl, createEnvValidator, serviceEnvShape } from '@repo/server-core';
import { z } from 'zod';

export const envSchema = z.object({
  ...serviceEnvShape('gateway-api'),
  // core-api's in-cluster URL: /api/v<N>/gateway/… is forwarded to it with the caller's Bearer token.
  CORE_API_URL: baseUrl(['http:', 'https:']),
});

export type Env = z.infer<typeof envSchema>;

/** `@nestjs/config` validate hook: parses `process.env` (plus any .env file) into a typed `Env`. */
export const validateEnv: (raw: Record<string, unknown>) => Env = createEnvValidator(envSchema);
