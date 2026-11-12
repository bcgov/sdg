import { readFileSync } from 'node:fs';

import { addSessionCookieAuth } from '@repo/bff-core/nestjs';
import type { SwaggerOptions } from '@repo/server-core/nestjs';
import { z } from 'zod';

import { SESSION_COOKIE } from '../bff/console-session.js';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** console-api's OpenAPI document (served at /api/docs outside production by configureApp). */
export const swaggerOptions: SwaggerOptions = {
  title: 'Console API',
  description:
    'Backend-for-frontend for console-web: sign-in and the console.sid session, forwarding /api/v1/{console,shared}/… to core-api.',
  version,
  configure: (builder) => addSessionCookieAuth(builder, SESSION_COOKIE),
};
