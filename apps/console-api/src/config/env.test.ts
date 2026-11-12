import { EnvValidationError } from '@repo/server-core';
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const valid = {
  APP_URL: 'https://sdg-12-console.apps.example.com/',
  DATABASE_URL: 'postgres://console:console@localhost:5432/portal',
  SESSION_SECRET: 'x'.repeat(32),
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard/',
  KEYCLOAK_CLIENT_ID: 'sdg-console',
  KEYCLOAK_CLIENT_SECRET: 'client-secret-value',
  CORE_API_URL: 'http://core-api:3000/',
};

function keysOf(raw: Record<string, unknown>): readonly string[] {
  try {
    validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.keys;
    throw error;
  }
  throw new Error('expected validateEnv to throw');
}

describe('console-api env', () => {
  it('Should parse a complete env, apply defaults and strip trailing slashes', () => {
    const env = validateEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      SESSION_TTL_SECONDS: 28_800,
      APP_URL: 'https://sdg-12-console.apps.example.com',
      KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard',
      CORE_API_URL: 'http://core-api:3000',
      OTEL_SERVICE_NAME: 'console-api',
    });
  });

  it.each(['APP_URL', 'DATABASE_URL', 'SESSION_SECRET', 'KEYCLOAK_ISSUER_URL', 'KEYCLOAK_CLIENT_ID', 'CORE_API_URL'])(
    'Should require %s',
    (key) => {
      expect(keysOf({ ...valid, [key]: undefined })).toEqual([key]);
    },
  );

  it('Should reject a short SESSION_SECRET, a plain http issuer and a non-postgres database', () => {
    expect(keysOf({ ...valid, SESSION_SECRET: 'too-short' })).toEqual(['SESSION_SECRET']);
    expect(keysOf({ ...valid, KEYCLOAK_ISSUER_URL: 'http://keycloak.example.com/realms/standard' })).toEqual([
      'KEYCLOAK_ISSUER_URL',
    ]);
    expect(keysOf({ ...valid, DATABASE_URL: 'mysql://localhost/portal' })).toEqual(['DATABASE_URL']);
  });
});
