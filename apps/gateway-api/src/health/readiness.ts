import type { HealthModuleAsyncOptions } from '@repo/server-core/nestjs';

/**
 * GET /healthz/ready checks nothing beyond liveness: gateway-api has no database, and core-api being down is answered
 * per request with 503. Taking every pod out of rotation for it would only turn those 503s into connection errors.
 */
export const readiness: HealthModuleAsyncOptions = { useFactory: () => ({}) };
