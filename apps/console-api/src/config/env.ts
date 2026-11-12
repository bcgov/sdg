import { bffEnvShape } from '@repo/bff-core';
import { createEnvValidator } from '@repo/server-core';
import { z } from 'zod';

export const envSchema = z.object({
  // The console (IDIR) client's settings come from bffEnvShape; core-api refuses its tokens without the admin client role.
  ...bffEnvShape('console-api'),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv: (raw: Record<string, unknown>) => Env = createEnvValidator(envSchema);
