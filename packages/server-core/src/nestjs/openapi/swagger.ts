import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

export interface SwaggerOptions {
  readonly title: string;
  readonly description: string;
  /** The service's version, e.g. from its own package.json. */
  readonly version: string;
  /** Adds the service's security schemes (e.g. `addCookieAuth`, `addBearerAuth`) to the document. */
  readonly configure?: (builder: DocumentBuilder) => DocumentBuilder;
}

/** Swagger UI at /api/docs and the OpenAPI JSON at /api/docs-json, generated from controller metadata and zod schemas. */
export function setupSwagger(app: INestApplication, options: SwaggerOptions): void {
  const builder = new DocumentBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setVersion(options.version);
  const config = (options.configure?.(builder) ?? builder).build();
  SwaggerModule.setup(SWAGGER_PATH, app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
    yamlDocumentUrl: `${SWAGGER_PATH}-yaml`,
  });
}
