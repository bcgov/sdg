import { RequestMethod, StandardSchemaValidationPipe, VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { Env } from './config/env.js';
import { recipientCors } from './http/cors.js';
import { metricsMiddleware } from './metrics/metrics.js';
import { setupSwagger } from './openapi/swagger.js';
import { servesApi } from './roles/role.js';
import { SEND_BODY_LIMIT } from './sending/send.schemas.js';

export const API_PREFIX = 'api';

/**
 * Applies the HTTP conventions shared by main.ts and the tests:
 * - every route lives under /api except the /healthz probes;
 * - URI versioning with no default version, so feature controllers opt in (`version: '1'` → /api/v1/…)
 *   and health stays unversioned;
 * - helmet headers on every response, then CORS for /api/v1/me/* when CORS_ALLOWED_ORIGINS lists any origin (KTD7),
 *   then Prometheus metrics (GET /metrics, outside /api);
 * - JSON bodies up to the send route's cap (413 above it), which bounds every route's body;
 * - zod (Standard Schema) validation for every parameter that declares `{ schema }`;
 * - Swagger UI at /api/docs outside production, in the roles that serve the API (the worker role serves only
 *   /healthz/* and /metrics, KTD4).
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  if (config.get('TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  const corsOrigins = config.get('CORS_ALLOWED_ORIGINS', { infer: true });
  if (corsOrigins.length > 0) app.enableCors(recipientCors(corsOrigins));
  app.use(metricsMiddleware);
  app.useBodyParser('json', { limit: SEND_BODY_LIMIT });
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'healthz/live', method: RequestMethod.GET },
      { path: 'healthz/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  const swagger = config.get('NODE_ENV', { infer: true }) !== 'production';
  if (swagger && servesApi(config.get('NOTIFICATION_ROLE', { infer: true }))) setupSwagger(app);
  app.enableShutdownHooks();
  return app;
}
