import { readFileSync } from 'node:fs';

import type { SwaggerOptions } from '@repo/server-core/nestjs';
import { z } from 'zod';

import { SESSION_COOKIE } from '../session/session.module.js';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** portal-api's OpenAPI document (served at /api/docs outside production by configureApp). */
export const swaggerOptions: SwaggerOptions = {
  title: 'Portal API',
  description: 'Backend-for-frontend for portal-web. Authenticated routes use the portal.sid session cookie.',
  version,
  configure: (builder) =>
    builder.addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE }, SESSION_COOKIE),
};
