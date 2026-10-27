import { describe, expect, it } from 'vitest';

import { EnvValidationError, validateEnv } from './env.js';

const valid = {
  APP_URL: 'http://localhost:5173/',
  DATABASE_URL: 'postgres://portal:portal@localhost:5432/portal',
  SESSION_SECRET: 'x'.repeat(32),
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/portal/',
  KEYCLOAK_CLIENT_ID: 'portal',
  KEYCLOAK_CLIENT_SECRET: 'client-secret-value',
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

describe('envSchema', () => {
  describe('valid env', () => {
    it('parses a complete env and applies defaults', () => {
      const env = validateEnv(valid);
      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(3000);
      expect(env.LOG_LEVEL).toBe('info');
      expect(env.SESSION_TTL_SECONDS).toBe(28_800);
      expect(env.TRUST_PROXY).toBe(false);
      expect(env.APP_URL).toBe('http://localhost:5173');
      expect(env.KEYCLOAK_ISSUER_URL).toBe('https://keycloak.example.com/realms/portal');
    });

    it('strips every trailing slash from APP_URL and KEYCLOAK_ISSUER_URL', () => {
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

    it('coerces PORT, SESSION_TTL_SECONDS and TRUST_PROXY', () => {
      const env = validateEnv({ ...valid, PORT: '8080', SESSION_TTL_SECONDS: '600', TRUST_PROXY: 'true' });
      expect(env.PORT).toBe(8080);
      expect(env.SESSION_TTL_SECONDS).toBe(600);
      expect(env.TRUST_PROXY).toBe(true);
      expect(errorOf({ ...valid, TRUST_PROXY: 'yes' }).keys).toEqual(['TRUST_PROXY']);
      expect(errorOf({ ...valid, PORT: '70000' }).keys).toEqual(['PORT']);
    });
  });

  describe('invalid env', () => {
    it('accepts pino log levels and rejects Nest-only names', () => {
      expect(validateEnv({ ...valid, LOG_LEVEL: 'trace' }).LOG_LEVEL).toBe('trace');
      expect(validateEnv({ ...valid, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
      expect(errorOf({ ...valid, LOG_LEVEL: 'log' }).keys).toEqual(['LOG_LEVEL']);
      expect(errorOf({ ...valid, LOG_LEVEL: 'verbose' }).keys).toEqual(['LOG_LEVEL']);
    });

    it('rejects a SESSION_SECRET shorter than 32 characters', () => {
      const error = errorOf({ ...valid, SESSION_SECRET: 'too-short' });
      expect(error.keys).toEqual(['SESSION_SECRET']);
      expect(error.message).toContain('SESSION_SECRET');
    });

    it('rejects a non-postgres DATABASE_URL', () => {
      const error = errorOf({ ...valid, DATABASE_URL: 'mysql://localhost/portal' });
      expect(error.keys).toEqual(['DATABASE_URL']);
      expect(error.message).toMatch(/postgres:\/\/ or postgresql:\/\//);
      expect(errorOf({ ...valid, KEYCLOAK_CLIENT_ID: undefined }).keys).toEqual(['KEYCLOAK_CLIENT_ID']);
    });

    it('rejects a plain http KEYCLOAK_ISSUER_URL', () => {
      const error = errorOf({ ...valid, KEYCLOAK_ISSUER_URL: 'http://keycloak.example.com/realms/portal' });
      expect(error.keys).toEqual(['KEYCLOAK_ISSUER_URL']);
      expect(error.message).toContain('Must use https://');
    });

    it('reports invalid keys without their values', () => {
      const secret = 'super-secret-but-short';
      const error = errorOf({ ...valid, SESSION_SECRET: secret, DATABASE_URL: 'mysql://user:hunter2@db/portal' });
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain('hunter2');
      expect(error.message).toMatch(/^Invalid environment:/);
    });
  });
});
