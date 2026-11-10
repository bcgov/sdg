import 'reflect-metadata';
import { BFF_APP_OPTIONS } from '@repo/bff-core/nestjs';
import { startService } from '@repo/server-core/nestjs';

import { AppModule } from './app.module.js';
import { swaggerOptions } from './openapi/swagger-options.js';

// BFF_APP_OPTIONS (rawBody): bff-core forwards request bodies to core-api byte for byte. The test app uses it too.
await startService(AppModule, { serviceName: 'portal-api', swagger: swaggerOptions, ...BFF_APP_OPTIONS });
