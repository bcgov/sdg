import 'reflect-metadata';
import { startService } from '@repo/server-core/nestjs';

import { AppModule } from './app.module.js';
import { swaggerOptions } from './openapi/swagger-options.js';

await startService(AppModule, { serviceName: 'gateway-api', swagger: swaggerOptions });
