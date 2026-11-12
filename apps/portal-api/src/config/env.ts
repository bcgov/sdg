import { bffEnvShape } from '@repo/bff-core';
import { createEnvValidator } from '@repo/server-core';
import { z } from 'zod';

export const envSchema = z.object({
  ...bffEnvShape('portal-api'),
});

export type Env = z.infer<typeof envSchema>;

/** `@nestjs/config` validate hook: parses `process.env` (plus any .env file) into a typed `Env`. */
export const validateEnv: (raw: Record<string, unknown>) => Env = createEnvValidator(envSchema);
