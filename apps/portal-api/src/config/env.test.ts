import { describe, expect, it } from 'vitest';

import { EnvValidationError, envSchema, validateEnv } from './env.js';

const valid = {
  APP_URL: 'http://localhost:5173/',
  DATABASE_URL: 'postgres://portal:portal@localhost:5432/portal',
  VALKEY_URL: 'redis://localhost:6379',
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

    it('Should coerce PORT, SESSION_TTL_SECONDS and TRUST_PROXY', () => {
      const env = validateEnv({
        ...valid,
        PORT: '8080',
        SESSION_TTL_SECONDS: '600',
        TRUST_PROXY: 'true',
      });
      expect(env.PORT).toBe(8080);
      expect(env.SESSION_TTL_SECONDS).toBe(600);
      expect(env.TRUST_PROXY).toBe(true);
      expect(errorOf({ ...valid, TRUST_PROXY: 'yes' }).keys).toEqual(['TRUST_PROXY']);
      expect(errorOf({ ...valid, PORT: '70000' }).keys).toEqual(['PORT']);
    });

    it('Should support https APP_URL, http KEYCLOAK_ISSUER_URL, postgresql DATABASE_URL and rediss VALKEY_URL without trailing slashes', () => {
      const env = validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_URL: 'https://portal.example.com',
        KEYCLOAK_ISSUER_URL: 'http://keycloak.local/realms/portal',
        DATABASE_URL: 'postgresql://portal:portal@localhost:5432/portal',
        VALKEY_URL: 'rediss://localhost:6379',
        TRUST_PROXY: 'false',
      });
      expect(env.NODE_ENV).toBe('production');
      expect(env.APP_URL).toBe('https://portal.example.com');
      expect(env.KEYCLOAK_ISSUER_URL).toBe('http://keycloak.local/realms/portal');
      expect(env.DATABASE_URL).toBe('postgresql://portal:portal@localhost:5432/portal');
      expect(env.VALKEY_URL).toBe('rediss://localhost:6379');
      expect(env.TRUST_PROXY).toBe(false);
    });

    it('Should support test NODE_ENV', () => {
      const env = validateEnv({
        ...valid,
        NODE_ENV: 'test',
      });
      expect(env.NODE_ENV).toBe('test');
    });
  });

  describe('Invalid env', () => {
    it('Should accept pino log levels and rejects Nest-only names', () => {
      expect(validateEnv({ ...valid, LOG_LEVEL: 'trace' }).LOG_LEVEL).toBe('trace');
      expect(validateEnv({ ...valid, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
      expect(errorOf({ ...valid, LOG_LEVEL: 'log' }).keys).toEqual(['LOG_LEVEL']);
      expect(errorOf({ ...valid, LOG_LEVEL: 'verbose' }).keys).toEqual(['LOG_LEVEL']);
    });

    it('Should reject an invalid NODE_ENV', () => {
      expect(errorOf({ ...valid, NODE_ENV: 'staging' }).keys).toEqual(['NODE_ENV']);
    });

    it('Should reject invalid PORT and SESSION_TTL_SECONDS ranges', () => {
      expect(errorOf({ ...valid, PORT: '0' }).keys).toEqual(['PORT']);
      expect(errorOf({ ...valid, SESSION_TTL_SECONDS: '299' }).keys).toEqual(['SESSION_TTL_SECONDS']);
    });

    it('Should reject a SESSION_SECRET shorter than 32 characters', () => {
      const error = errorOf({ ...valid, SESSION_SECRET: 'too-short' });
      expect(error.keys).toEqual(['SESSION_SECRET']);
      expect(error.message).toContain('SESSION_SECRET');
    });

    it('Should reject non-postgres DATABASE_URL and non-redis VALKEY_URL', () => {
      const error = errorOf({
        ...valid,
        DATABASE_URL: 'mysql://localhost/portal',
        VALKEY_URL: 'http://localhost:6379',
      });
      expect(error.keys.toSorted()).toEqual(['DATABASE_URL', 'VALKEY_URL']);
      expect(error.message).toMatch(/postgres:\/\/ or postgresql:\/\//);
      expect(errorOf({ ...valid, KEYCLOAK_CLIENT_ID: undefined }).keys).toEqual(['KEYCLOAK_CLIENT_ID']);
      expect(errorOf({ ...valid, KEYCLOAK_CLIENT_SECRET: '' }).keys).toEqual(['KEYCLOAK_CLIENT_SECRET']);
    });

    it('Should reject invalid protocols for APP_URL and KEYCLOAK_ISSUER_URL', () => {
      expect(errorOf({ ...valid, APP_URL: 'ftp://localhost' }).keys).toEqual(['APP_URL']);
      expect(
        errorOf({
          ...valid,
          KEYCLOAK_ISSUER_URL: 'ftp://keycloak.example.com',
        }).keys,
      ).toEqual(['KEYCLOAK_ISSUER_URL']);
    });

    it('Should format root-level validation errors using (root)', () => {
      const error = errorOf(null!);
      expect(error.name).toBe('EnvValidationError');
      expect(error.message).toMatch(/Invalid environment:\n\s+\(root\):/);
      expect(error.keys).toEqual(['']);
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

  describe('EnvValidationError', () => {
    it('Should format issue with empty path as (root)', () => {
      const parseResult = envSchema.safeParse(null);
      expect(parseResult.success).toBe(false);
      const error = new EnvValidationError(parseResult.error!.issues);
      expect(error.name).toBe('EnvValidationError');
      expect(error.message).toMatch(/Invalid environment:\n\s+\(root\):/);
      expect(error.keys).toEqual(['']);
    });

    it('Should format issue with key path using dot separator', () => {
      const parseResult = envSchema.safeParse({});
      expect(parseResult.success).toBe(false);
      const error = new EnvValidationError(parseResult.error!.issues);
      expect(error.name).toBe('EnvValidationError');
      expect(error.message).toContain('  APP_URL:');
      expect(error.keys).toContain('APP_URL');
    });
  });
});
