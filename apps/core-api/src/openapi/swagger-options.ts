import { readFileSync } from 'node:fs';

import type { SwaggerOptions } from '@repo/server-core/nestjs';
import { z } from 'zod';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** core-api's OpenAPI document (served at /api/docs outside production by configureApp). */
export const swaggerOptions: SwaggerOptions = {
  title: 'Core API',
  description:
    'Business rules behind portal-api, admin-api and gateway-api. Every route takes the caller’s Keycloak access ' +
    'token as a Bearer token; /internal/* is for the BFFs only.',
  version,
  configure: (builder) => builder.addBearerAuth(),
};
