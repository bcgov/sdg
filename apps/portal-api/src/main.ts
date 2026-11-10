import 'reflect-metadata';
import { startService } from '@repo/server-core/nestjs';

import { AppModule } from './app.module.js';
import { swaggerOptions } from './openapi/swagger-options.js';

// Exits non-zero on a failed start, an unhandled rejection or an uncaught exception (startService).
await startService(AppModule, { serviceName: 'portal-api', swagger: swaggerOptions });
