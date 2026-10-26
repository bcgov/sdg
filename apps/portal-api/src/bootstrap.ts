import { RequestMethod, StandardSchemaValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { Env } from './config/env.js';
import { metricsMiddleware } from './metrics/metrics.js';
import { setupSwagger } from './openapi/swagger.js';

export const API_PREFIX = 'api';

/**
 * Applies the HTTP conventions shared by main.ts and the tests:
 * - every route lives under /api except the /healthz probes;
 * - URI versioning with no default version, so feature controllers opt in (`version: '1'` → /api/v1/…)
 *   and auth/health stay unversioned;
 * - helmet headers on every response, then Prometheus metrics (GET /metrics, outside /api);
 * - zod (Standard Schema) validation for every parameter that declares `{ schema }`;
 * - Swagger UI at /api/docs outside production.
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  if (config.get('TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(metricsMiddleware);
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'healthz/live', method: RequestMethod.GET },
      { path: 'healthz/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app);
  app.enableShutdownHooks();
  return app;
}
