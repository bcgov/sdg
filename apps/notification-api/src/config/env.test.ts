import { describe, expect, it } from 'vitest';

import { EnvValidationError, validateEnv } from './env.js';

const ENCRYPTION_KEY = 'k'.repeat(40);

const valid = {
  DATABASE_URL: 'postgres://notification:notification@localhost:5432/notification',
  KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard/',
  NOTIFICATION_CLIENT_ID: 'notification-api',
  NOTIFICATION_ENCRYPTION_KEY: ENCRYPTION_KEY,
  CONFIRM_EMAIL_URL: 'https://portal.example.com/confirm-email',
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
    it('parses a minimal env and applies the defaults', () => {
      const env = validateEnv(valid);
      expect(env).toMatchObject({
        NODE_ENV: 'development',
        PORT: 3000,
        LOG_LEVEL: 'info',
        TRUST_PROXY: false,
        NOTIFICATION_ROLE: 'all',
        KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/standard',
        RELAYING_CLIENT_IDS: [],
        NOTIFICATION_OUTBOUND_ALLOW_HOSTS: [],
        CORS_ALLOWED_ORIGINS: [],
        DEFAULT_TIMEZONE: 'America/Vancouver',
        OTEL_SERVICE_NAME: 'notification-api',
      });
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    });

    it('splits RELAYING_CLIENT_IDS and NOTIFICATION_OUTBOUND_ALLOW_HOSTS on commas, dropping blanks', () => {
      const env = validateEnv({
        ...valid,
        RELAYING_CLIENT_IDS: 'portal, other-bff,,',
        NOTIFICATION_OUTBOUND_ALLOW_HOSTS: ' mailpit ,webhook-receiver',
      });
      expect(env.RELAYING_CLIENT_IDS).toEqual(['portal', 'other-bff']);
      expect(env.NOTIFICATION_OUTBOUND_ALLOW_HOSTS).toEqual(['mailpit', 'webhook-receiver']);
      expect(validateEnv({ ...valid, RELAYING_CLIENT_IDS: '  ' }).RELAYING_CLIENT_IDS).toEqual([]);
    });

    it('splits CORS_ALLOWED_ORIGINS into exact origins', () => {
      const env = validateEnv({ ...valid, CORS_ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:5173,,' });
      expect(env.CORS_ALLOWED_ORIGINS).toEqual(['https://app.example.com', 'http://localhost:5173']);
      expect(validateEnv({ ...valid, CORS_ALLOWED_ORIGINS: ' ' }).CORS_ALLOWED_ORIGINS).toEqual([]);
    });

    it('accepts each role and treats a blank NOTIFICATION_ROLE as all', () => {
      expect(validateEnv({ ...valid, NOTIFICATION_ROLE: 'api' }).NOTIFICATION_ROLE).toBe('api');
      expect(validateEnv({ ...valid, NOTIFICATION_ROLE: 'worker' }).NOTIFICATION_ROLE).toBe('worker');
      expect(validateEnv({ ...valid, NOTIFICATION_ROLE: 'all' }).NOTIFICATION_ROLE).toBe('all');
      expect(validateEnv({ ...valid, NOTIFICATION_ROLE: '' }).NOTIFICATION_ROLE).toBe('all');
    });

    it('leaves the platform-default SMTP keys undefined when blank, and coerces them when set', () => {
      const blank = validateEnv({ ...valid, DEFAULT_SMTP_HOST: '', DEFAULT_SMTP_PORT: '', DEFAULT_SMTP_SECURE: '' });
      expect(blank.DEFAULT_SMTP_HOST).toBeUndefined();
      expect(blank.DEFAULT_SMTP_PORT).toBeUndefined();
      expect(blank.DEFAULT_SMTP_SECURE).toBeUndefined();
      const set = validateEnv({
        ...valid,
        DEFAULT_SMTP_HOST: 'smtp.example.com',
        DEFAULT_SMTP_PORT: '465',
        DEFAULT_SMTP_SECURE: 'true',
        DEFAULT_SMTP_USER: 'mailer',
        DEFAULT_SMTP_PASSWORD: 'mailer-password',
        DEFAULT_SMTP_FROM: 'Notifications <noreply@example.com>',
      });
      expect(set).toMatchObject({
        DEFAULT_SMTP_HOST: 'smtp.example.com',
        DEFAULT_SMTP_PORT: 465,
        DEFAULT_SMTP_SECURE: true,
        DEFAULT_SMTP_FROM: 'Notifications <noreply@example.com>',
      });
    });
  });

  describe('invalid env', () => {
    it('fails without NOTIFICATION_ENCRYPTION_KEY, naming the key and no value', () => {
      const { NOTIFICATION_ENCRYPTION_KEY: _omitted, ...withoutKey } = valid;
      const error = errorOf({ ...withoutKey, DATABASE_URL: 'postgres://user:hunter2@db/notification' });
      expect(error.keys).toEqual(['NOTIFICATION_ENCRYPTION_KEY']);
      expect(error.message).toMatch(/^Invalid environment:\n {2}NOTIFICATION_ENCRYPTION_KEY: /);
      expect(error.message).not.toContain('hunter2');
    });

    it('rejects a NOTIFICATION_ENCRYPTION_KEY shorter than 32 characters without echoing it', () => {
      const short = 'short-but-secret-key';
      const error = errorOf({ ...valid, NOTIFICATION_ENCRYPTION_KEY: short });
      expect(error.keys).toEqual(['NOTIFICATION_ENCRYPTION_KEY']);
      expect(error.message).not.toContain(short);
      expect(validateEnv({ ...valid, NOTIFICATION_ENCRYPTION_KEY: 'x'.repeat(32) }).NOTIFICATION_ENCRYPTION_KEY).toBe(
        'x'.repeat(32),
      );
    });

    it('rejects an unknown NOTIFICATION_ROLE', () => {
      const error = errorOf({ ...valid, NOTIFICATION_ROLE: 'scheduler' });
      expect(error.keys).toEqual(['NOTIFICATION_ROLE']);
      expect(error.message).not.toContain('scheduler');
    });

    it('requires an https KEYCLOAK_ISSUER_URL, a postgres DATABASE_URL and NOTIFICATION_CLIENT_ID', () => {
      expect(errorOf({ ...valid, KEYCLOAK_ISSUER_URL: 'http://keycloak.example.com/realms/standard' }).keys).toEqual([
        'KEYCLOAK_ISSUER_URL',
      ]);
      expect(errorOf({ ...valid, DATABASE_URL: 'mysql://localhost/notification' }).keys).toEqual(['DATABASE_URL']);
      expect(errorOf({ ...valid, NOTIFICATION_CLIENT_ID: undefined }).keys).toEqual(['NOTIFICATION_CLIENT_ID']);
    });

    it('rejects an unknown DEFAULT_TIMEZONE and a malformed DEFAULT_SMTP_PORT or DEFAULT_SMTP_SECURE', () => {
      expect(validateEnv({ ...valid, DEFAULT_TIMEZONE: 'Europe/Paris' }).DEFAULT_TIMEZONE).toBe('Europe/Paris');
      expect(errorOf({ ...valid, DEFAULT_TIMEZONE: 'Mars/Olympus_Mons' }).keys).toEqual(['DEFAULT_TIMEZONE']);
      expect(errorOf({ ...valid, DEFAULT_SMTP_PORT: '70000' }).keys).toEqual(['DEFAULT_SMTP_PORT']);
      expect(errorOf({ ...valid, DEFAULT_SMTP_SECURE: 'yes' }).keys).toEqual(['DEFAULT_SMTP_SECURE']);
    });

    it('rejects a CORS_ALLOWED_ORIGINS entry that is not an exact http or https origin', () => {
      for (const entry of [
        'app.example.com',
        'https://app.example.com/',
        'https://app.example.com/portal',
        'https://App.example.com',
        'ftp://app.example.com',
        '*',
      ]) {
        const error = errorOf({ ...valid, CORS_ALLOWED_ORIGINS: `https://ok.example.com,${entry}` });
        expect(error.keys).toEqual(['CORS_ALLOWED_ORIGINS.1']);
        expect(error.message).not.toContain(entry);
      }
    });

    it('lists every bad key at once', () => {
      const error = errorOf({ ...valid, NOTIFICATION_ROLE: 'scheduler', PORT: '0', LOG_LEVEL: 'verbose' });
      expect(error.keys.toSorted()).toEqual(['LOG_LEVEL', 'NOTIFICATION_ROLE', 'PORT']);
    });
  });
});
