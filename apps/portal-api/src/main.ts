import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import type { Env } from './config/env.js';

const logger = new Logger('Bootstrap');

function exitOnFatal(kind: string) {
  return (error: unknown): void => {
    logger.fatal(`${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  };
}

process.on('unhandledRejection', exitOnFatal('Unhandled promise rejection'));
process.on('uncaughtException', exitOnFatal('Uncaught exception'));

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Route Nest's Logger (and the logs buffered during bootstrap) through nestjs-pino.
  app.useLogger(app.get(PinoLogger));
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`portal-api listening on port ${port}`);
}

main().catch(exitOnFatal('Failed to start portal-api'));
