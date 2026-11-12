import 'reflect-metadata';
import { startService } from '@repo/server-core/nestjs';

import { AppModule, UNPREFIXED_ROUTES } from './app.module.js';
import { swaggerOptions } from './openapi/swagger-options.js';

await startService(AppModule, { serviceName: 'core-api', swagger: swaggerOptions, unprefixed: UNPREFIXED_ROUTES });
