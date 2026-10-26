import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';

import { SESSION_COOKIE } from '../session/session.module.js';

export const SWAGGER_PATH = 'api/docs';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** Swagger UI at /api/docs and the OpenAPI JSON at /api/docs-json, generated from controller metadata and zod schemas. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Portal API')
    .setDescription('Backend-for-frontend for portal-web. Authenticated routes use the portal.sid session cookie.')
    .setVersion(version)
    .addCookieAuth(SESSION_COOKIE, { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE }, SESSION_COOKIE)
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    yamlDocumentUrl: `${SWAGGER_PATH}-yaml`,
  });
}
