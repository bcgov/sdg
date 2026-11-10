import { baseUrl, blankAsMissing, createEnvValidator, serviceEnvShape, urlWithProtocol } from '@repo/server-core';
import { z } from 'zod';

const clientId = z.string().regex(/^[A-Za-z0-9._-]+$/, 'Must be a Keycloak client id');

export const envSchema = z
  .object({
    ...serviceEnvShape('core-api'),
    DATABASE_URL: urlWithProtocol(['postgres:', 'postgresql:']),
    KEYCLOAK_ISSUER_URL: baseUrl(['https:']),
    /** The portal (BCSC) client: its person tokens reach portal and shared routes. */
    PORTAL_CLIENT_ID: clientId,
    /** The admin (IDIR) client. Optional until admin-api exists (KTD13): unset, no admin-client token is accepted. */
    ADMIN_CLIENT_ID: z.preprocess(blankAsMissing, clientId.optional()),
  })
  .refine((env) => env.ADMIN_CLIENT_ID !== env.PORTAL_CLIENT_ID, {
    path: ['ADMIN_CLIENT_ID'],
    message: 'Must differ from PORTAL_CLIENT_ID',
  });

export type Env = z.infer<typeof envSchema>;

/** `@nestjs/config` validate hook: parses `process.env` (plus any .env file) into a typed `Env`. */
export const validateEnv: (raw: Record<string, unknown>) => Env = createEnvValidator(envSchema);
