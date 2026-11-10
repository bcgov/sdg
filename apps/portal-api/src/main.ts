import 'reflect-metadata';
import { startService } from '@repo/server-core/nestjs';

import { AppModule } from './app.module.js';
import { swaggerOptions } from './openapi/swagger-options.js';

// rawBody: bff-core forwards request bodies to core-api byte for byte.
await startService(AppModule, { serviceName: 'portal-api', swagger: swaggerOptions, rawBody: true });
