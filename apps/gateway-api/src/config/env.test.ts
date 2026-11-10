import { EnvValidationError } from '@repo/server-core';
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

function keysOf(raw: Record<string, unknown>): readonly string[] {
  try {
    validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.keys;
    throw error;
  }
  throw new Error('expected validateEnv to throw');
}

describe('gateway-api env', () => {
  it('Should parse CORE_API_URL without its trailing slash and apply the service defaults', () => {
    expect(validateEnv({ CORE_API_URL: 'http://core-api:3000/' })).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: false,
      CORE_API_URL: 'http://core-api:3000',
      OTEL_SERVICE_NAME: 'gateway-api',
    });
  });

  it('Should require an http(s) CORE_API_URL', () => {
    expect(keysOf({})).toEqual(['CORE_API_URL']);
    expect(keysOf({ CORE_API_URL: 'ftp://core-api' })).toEqual(['CORE_API_URL']);
  });

  it('Should read TRUST_PROXY', () => {
    expect(validateEnv({ CORE_API_URL: 'http://core-api:3000', TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });
});
