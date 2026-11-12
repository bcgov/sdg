import { EnvValidationError } from '@repo/server-core';
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const valid = {
  APP_URL: 'http://localhost:5173/',
  DATABASE_URL: 'postgres://portal:portal@localhost:5432/portal',
  SESSION_SECRET: 'x'.repeat(32),
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/portal/',
  KEYCLOAK_CLIENT_ID: 'portal',
  KEYCLOAK_CLIENT_SECRET: 'client-secret-value',
  CORE_API_URL: 'http://core-api:3000/',
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

describe('Env Config Unit Test Suite', () => {
  describe('Valid env', () => {
    it('Should parse a complete env and applies defaults', () => {
      const env = validateEnv(valid);
      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(3000);
      expect(env.LOG_LEVEL).toBe('info');
      expect(env.SESSION_TTL_SECONDS).toBe(28_800);
      expect(env.TRUST_PROXY).toBe(false);
      expect(env.APP_URL).toBe('http://localhost:5173');
      expect(env.KEYCLOAK_ISSUER_URL).toBe('https://keycloak.example.com/realms/portal');
    });

    it('Should strip every trailing slash from APP_URL and KEYCLOAK_ISSUER_URL', () => {
      const env = validateEnv({
        ...valid,
        APP_URL: 'https://portal.example.com///',
        KEYCLOAK_ISSUER_URL: 'https://kc.test//',
      });
      expect(env.APP_URL).toBe('https://portal.example.com');
      expect(env.KEYCLOAK_ISSUER_URL).toBe('https://kc.test');
      expect(validateEnv({ ...valid, APP_URL: 'https://portal.example.com/a/' }).APP_URL).toBe(
        'https://portal.example.com/a',
      );
    });

    it('Should coerce PORT, SESSION_TTL_SECONDS and TRUST_PROXY', () => {
      const env = validateEnv({ ...valid, PORT: '8080', SESSION_TTL_SECONDS: '600', TRUST_PROXY: 'true' });
      expect(env.PORT).toBe(8080);
      expect(env.SESSION_TTL_SECONDS).toBe(600);
      expect(env.TRUST_PROXY).toBe(true);
      expect(errorOf({ ...valid, TRUST_PROXY: 'yes' }).keys).toEqual(['TRUST_PROXY']);
      expect(errorOf({ ...valid, PORT: '70000' }).keys).toEqual(['PORT']);
    });

    it('Should support https APP_URL, https KEYCLOAK_ISSUER_URL and postgresql DATABASE_URL without trailing slashes', () => {
      const env = validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'https://portal.example.com',
        KEYCLOAK_ISSUER_URL: 'https://keycloak.local/realms/portal',
        DATABASE_URL: 'postgresql://portal:portal@localhost:5432/portal',
        TRUST_PROXY: 'false',
      });
      expect(env.NODE_ENV).toBe('production');
      expect(env.APP_URL).toBe('https://portal.example.com');
      expect(env.KEYCLOAK_ISSUER_URL).toBe('https://keycloak.local/realms/portal');
      expect(env.DATABASE_URL).toBe('postgresql://portal:portal@localhost:5432/portal');
      expect(env.TRUST_PROXY).toBe(false);
    });
  });

  describe('Invalid env', () => {
    it('Should reject invalid PORT and SESSION_TTL_SECONDS ranges', () => {
      expect(errorOf({ ...valid, PORT: '0' }).keys).toEqual(['PORT']);
      expect(errorOf({ ...valid, SESSION_TTL_SECONDS: '299' }).keys).toEqual(['SESSION_TTL_SECONDS']);
    });

    it('Should reject a SESSION_SECRET shorter than 32 characters', () => {
      const error = errorOf({ ...valid, SESSION_SECRET: 'too-short' });
      expect(error.keys).toEqual(['SESSION_SECRET']);
      expect(error.message).toContain('SESSION_SECRET');
    });

    it('Should reject a non-postgres DATABASE_URL', () => {
      const error = errorOf({ ...valid, DATABASE_URL: 'mysql://localhost/portal' });
      expect(error.keys).toEqual(['DATABASE_URL']);
      expect(error.message).toMatch(/postgres:\/\/ or postgresql:\/\//);
      expect(errorOf({ ...valid, KEYCLOAK_CLIENT_ID: undefined }).keys).toEqual(['KEYCLOAK_CLIENT_ID']);
      expect(errorOf({ ...valid, KEYCLOAK_CLIENT_SECRET: '' }).keys).toEqual(['KEYCLOAK_CLIENT_SECRET']);
    });

    it('Should reject a plain http KEYCLOAK_ISSUER_URL', () => {
      const error = errorOf({ ...valid, KEYCLOAK_ISSUER_URL: 'http://keycloak.example.com/realms/portal' });
      expect(error.keys).toEqual(['KEYCLOAK_ISSUER_URL']);
      expect(error.message).toContain('Must use https://');
    });

    it('Should report invalid keys without their values', () => {
      const secret = 'super-secret-but-short';
      const error = errorOf({
        ...valid,
        SESSION_SECRET: secret,
        DATABASE_URL: 'mysql://user:hunter2@db/portal',
      });
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain('hunter2');
      expect(error.message).toMatch(/^Invalid environment:/);
    });
  });

  describe('CORE_API_URL', () => {
    it('Should accept core-api over in-cluster http and strip the trailing slash', () => {
      expect(validateEnv(valid).CORE_API_URL).toBe('http://core-api:3000');
    });

    it('Should be required and a http(s) URL', () => {
      expect(errorOf({ ...valid, CORE_API_URL: undefined }).keys).toEqual(['CORE_API_URL']);
      expect(errorOf({ ...valid, CORE_API_URL: 'postgres://core-api:3000' }).keys).toEqual(['CORE_API_URL']);
    });
  });

  describe('OpenTelemetry vars', () => {
    it('Should default OTEL_SERVICE_NAME to portal-api', () => {
      expect(validateEnv(valid).OTEL_SERVICE_NAME).toBe('portal-api');
      expect(validateEnv({ ...valid, OTEL_SERVICE_NAME: 'portal-api-canary' }).OTEL_SERVICE_NAME).toBe(
        'portal-api-canary',
      );
    });
  });
});
