import type { IncomingMessage } from 'node:http';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';

import type { ServiceEnv } from '../../env.js';
import { isQuietPath } from '../../quiet-paths.js';

/** Header values that carry the session or credentials; pino replaces them with "[Redacted]". */
const REDACTED_PATHS = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];

/** pino-http options: JSON lines, pino-pretty in development only, one line per request except probes/scrapes. */
export function pinoHttpOptions(env: Pick<ServiceEnv, 'NODE_ENV' | 'LOG_LEVEL'>): Options {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS },
    // Nest mounts middleware on a path, which rewrites req.url; originalUrl is the full request path.
    autoLogging: {
      ignore: (req: IncomingMessage & { originalUrl?: string }) => isQuietPath(req.originalUrl ?? req.url ?? ''),
    },
    ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
  };
}

/** nestjs-pino's LoggerModule with `pinoHttpOptions`, reading NODE_ENV and LOG_LEVEL from the global ConfigService. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ServiceEnv, true>) => ({
        pinoHttp: pinoHttpOptions({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
      }),
    }),
  ],
})
export class LoggingModule {}
