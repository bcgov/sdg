import { RequestMethod, StandardSchemaValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { ServiceEnv } from '../../env.js';
import { metricsMiddleware } from '../metrics/metrics.js';
import { setupSwagger, type SwaggerOptions } from '../openapi/swagger.js';

export const API_PREFIX = 'api';

export interface ConfigureAppOptions {
  /** The OpenAPI document served at /api/docs outside production. */
  readonly swagger: SwaggerOptions;
  /**
   * Route paths (Nest path syntax, e.g. `internal/{*path}`) served outside /api, for every method: core-api's
   * BFF-only `/internal/*` routes, which no forwarder forwards (KTD2).
   */
  readonly unprefixed?: readonly string[];
}

/**
 * Applies the HTTP conventions shared by every service's main.ts and its tests:
 * - every route lives under /api except the /healthz probes and `options.unprefixed`;
 * - URI versioning with no default version, so feature controllers opt in (`version: '1'` → /api/v1/…)
 *   and auth/health stay unversioned;
 * - helmet headers on every response, then Prometheus metrics (GET /metrics, outside /api);
 * - zod (Standard Schema) validation for every parameter that declares `{ schema }`;
 * - Swagger UI at /api/docs outside production.
 */
export function configureApp(app: NestExpressApplication, options: ConfigureAppOptions): INestApplication {
  const config = app.get<ConfigService<ServiceEnv, true>>(ConfigService);
  if (config.get('TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(metricsMiddleware);
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'healthz/live', method: RequestMethod.GET },
      { path: 'healthz/ready', method: RequestMethod.GET },
      ...(options.unprefixed ?? []).map((path) => ({ path, method: RequestMethod.ALL })),
    ],
  });
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app, options.swagger);
  app.enableShutdownHooks();
  return app;
}
