import { readFileSync } from 'node:fs';

import type { SwaggerOptions } from '@repo/server-core/nestjs';
import { z } from 'zod';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** gateway-api's OpenAPI document (served at /api/docs outside production by configureApp). */
export const swaggerOptions: SwaggerOptions = {
  title: 'Gateway API',
  description:
    'Entry point for registered service accounts: forwards GET /api/v1/gateway/… to core-api with the caller’s ' +
    'client-credentials Bearer token, which core-api verifies. Other methods are 405; other paths 404. See core-api’s ' +
    'document for the gateway routes.',
  version,
  configure: (builder) => builder.addBearerAuth(),
};
