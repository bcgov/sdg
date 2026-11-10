import { readFileSync } from 'node:fs';

import { addSessionCookieAuth } from '@repo/bff-core/nestjs';
import type { SwaggerOptions } from '@repo/server-core/nestjs';
import { z } from 'zod';

import { SESSION_COOKIE } from '../bff/admin-session.js';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** admin-api's OpenAPI document (served at /api/docs outside production by configureApp). */
export const swaggerOptions: SwaggerOptions = {
  title: 'Admin API',
  description:
    'Backend-for-frontend for admin-web: sign-in and the admin.sid session, forwarding /api/v1/{admin,shared}/… to core-api.',
  version,
  configure: (builder) => addSessionCookieAuth(builder, SESSION_COOKIE),
};
