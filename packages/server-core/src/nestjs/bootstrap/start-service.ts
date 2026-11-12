import { Logger, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';

import type { ServiceEnv } from '../../env.js';
import { configureApp, type ConfigureAppOptions } from './configure-app.js';

export interface StartServiceOptions extends ConfigureAppOptions {
  /** Names the service in the startup log lines, e.g. `portal-api`. */
  readonly serviceName: string;
  /** Keeps each request's raw body (`req.rawBody`), which a forwarder relays byte for byte (bff-core). Default false. */
  readonly rawBody?: boolean;
}

const logger = new Logger('Bootstrap');

function exitOnFatal(kind: string): (error: unknown) => void {
  return (error) => {
    logger.fatal(`${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  };
}

async function listen(appModule: Type, options: StartServiceOptions): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(appModule, {
    bufferLogs: true,
    rawBody: options.rawBody ?? false,
  });
  app.useLogger(app.get(PinoLogger));
  const config = app.get<ConfigService<ServiceEnv, true>>(ConfigService);
  configureApp(app, options);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`${options.serviceName} listening on port ${port}`);
}

/**
 * A service's main.ts: exits on an unhandled rejection or uncaught exception (logged as fatal), then creates the app
 * from `appModule` (which imports LoggingModule and a global ConfigModule), applies `configureApp` and listens on PORT.
 * A failed start is logged and exits non-zero.
 */
export async function startService(appModule: Type, options: StartServiceOptions): Promise<void> {
  process.on('unhandledRejection', exitOnFatal('Unhandled promise rejection'));
  process.on('uncaughtException', exitOnFatal('Uncaught exception'));
  try {
    await listen(appModule, options);
  } catch (error) {
    exitOnFatal(`Failed to start ${options.serviceName}`)(error);
  }
}
