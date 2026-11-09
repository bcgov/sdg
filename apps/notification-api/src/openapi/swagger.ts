import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';

export const SWAGGER_PATH = 'api/docs';

/** The security scheme name controllers reference with `@ApiBearerAuth(BEARER_AUTH)`. */
export const BEARER_AUTH = 'bearer';

const { version } = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')));

/** Swagger UI at /api/docs and the OpenAPI JSON at /api/docs-json, generated from controller metadata and zod schemas. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Notification API')
    .setDescription('Shared notification service. Every API route takes a Keycloak access token as a bearer token.')
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_AUTH)
    .build();
  SwaggerModule.setup(SWAGGER_PATH, app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    yamlDocumentUrl: `${SWAGGER_PATH}-yaml`,
  });
}
