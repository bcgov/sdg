import { EnvValidationError } from '@repo/server-core';
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://core:core@localhost:5432/portal',
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard/',
  PORTAL_CLIENT_ID: 'sdg-portal-1234',
};

function errorOf(raw: Record<string, unknown>): EnvValidationError {
  try {
    validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected validateEnv to throw');
}

describe('core-api env', () => {
  it('Should parse a Phase 1 env without an admin client and apply defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.OTEL_SERVICE_NAME).toBe('core-api');
    expect(env.KEYCLOAK_ISSUER_URL).toBe('https://keycloak.example.com/realms/standard');
    expect(env.ADMIN_CLIENT_ID).toBeUndefined();
    expect(validateEnv({ ...valid, ADMIN_CLIENT_ID: '' }).ADMIN_CLIENT_ID).toBeUndefined();
  });

  it('Should accept an admin client id', () => {
    expect(validateEnv({ ...valid, ADMIN_CLIENT_ID: 'sdg-admin-5678' }).ADMIN_CLIENT_ID).toBe('sdg-admin-5678');
  });

  it('Should reject an admin client id equal to the portal client id', () => {
    expect(errorOf({ ...valid, ADMIN_CLIENT_ID: valid.PORTAL_CLIENT_ID }).keys).toEqual(['ADMIN_CLIENT_ID']);
  });

  it('Should require the portal client, an https issuer and a postgres URL', () => {
    expect(errorOf({ ...valid, PORTAL_CLIENT_ID: undefined }).keys).toEqual(['PORTAL_CLIENT_ID']);
    expect(errorOf({ ...valid, PORTAL_CLIENT_ID: 'has space' }).keys).toEqual(['PORTAL_CLIENT_ID']);
    expect(errorOf({ ...valid, KEYCLOAK_ISSUER_URL: 'http://keycloak.example.com' }).keys).toEqual([
      'KEYCLOAK_ISSUER_URL',
    ]);
    expect(errorOf({ ...valid, DATABASE_URL: 'mysql://core:hunter2@db/portal' }).message).not.toContain('hunter2');
  });
});
