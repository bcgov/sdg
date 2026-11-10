import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { baseUrl, createEnvValidator, EnvValidationError, serviceEnvShape, urlWithProtocol } from './env.js';

const validateEnv = createEnvValidator(
  z.object({
    ...serviceEnvShape('core-api'),
    UPSTREAM_URL: baseUrl(['http:', 'https:']),
    ISSUER_URL: urlWithProtocol(['https:']),
  }),
);

const valid = { UPSTREAM_URL: 'http://core-api:3000/', ISSUER_URL: 'https://keycloak.example.com/realms/x' };

function errorOf(raw: Record<string, unknown>): EnvValidationError {
  try {
    validateEnv(raw);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error('expected validateEnv to throw');
}

describe('serviceEnvShape', () => {
  it('applies the defaults every service shares', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.OTEL_SERVICE_NAME).toBe('core-api');
    expect(env.OTEL_TRACES_SAMPLER_ARG).toBe(1);
  });

  it('coerces PORT and TRUST_PROXY and rejects values out of range', () => {
    const env = validateEnv({ ...valid, PORT: '8080', TRUST_PROXY: 'true', NODE_ENV: 'test' });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(true);
    expect(env.NODE_ENV).toBe('test');
    expect(errorOf({ ...valid, TRUST_PROXY: 'yes' }).keys).toEqual(['TRUST_PROXY']);
    expect(errorOf({ ...valid, PORT: '70000' }).keys).toEqual(['PORT']);
    expect(errorOf({ ...valid, PORT: '0' }).keys).toEqual(['PORT']);
    expect(errorOf({ ...valid, NODE_ENV: 'staging' }).keys).toEqual(['NODE_ENV']);
  });

  it('accepts pino log levels and rejects Nest-only names', () => {
    expect(validateEnv({ ...valid, LOG_LEVEL: 'trace' }).LOG_LEVEL).toBe('trace');
    expect(validateEnv({ ...valid, LOG_LEVEL: 'silent' }).LOG_LEVEL).toBe('silent');
    expect(errorOf({ ...valid, LOG_LEVEL: 'log' }).keys).toEqual(['LOG_LEVEL']);
    expect(errorOf({ ...valid, LOG_LEVEL: 'verbose' }).keys).toEqual(['LOG_LEVEL']);
  });

  it('treats a blank OTEL_EXPORTER_OTLP_ENDPOINT as unset and strips its trailing slash', () => {
    expect(validateEnv({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: '' }).OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    const env = validateEnv({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318/', OTEL_SERVICE_NAME: 'x' });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://alloy:4318');
    expect(env.OTEL_SERVICE_NAME).toBe('x');
  });

  it('rejects a non-http OTEL_EXPORTER_OTLP_ENDPOINT and a sampler ratio outside 0–1', () => {
    expect(errorOf({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: 'grpc://alloy:4317' }).keys).toEqual([
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ]);
    expect(errorOf({ ...valid, OTEL_TRACES_SAMPLER_ARG: '2' }).keys).toEqual(['OTEL_TRACES_SAMPLER_ARG']);
    expect(errorOf({ ...valid, OTEL_TRACES_SAMPLER_ARG: '-0.1' }).keys).toEqual(['OTEL_TRACES_SAMPLER_ARG']);
  });
});

describe('URL helpers', () => {
  it('strips every trailing slash from a base URL', () => {
    expect(validateEnv({ ...valid, UPSTREAM_URL: 'https://core.example.com///' }).UPSTREAM_URL).toBe(
      'https://core.example.com',
    );
    expect(validateEnv({ ...valid, UPSTREAM_URL: 'https://core.example.com/a/' }).UPSTREAM_URL).toBe(
      'https://core.example.com/a',
    );
  });

  it('names the allowed protocols', () => {
    const error = errorOf({ ...valid, ISSUER_URL: 'http://keycloak.example.com/realms/x' });
    expect(error.keys).toEqual(['ISSUER_URL']);
    expect(error.message).toContain('Must use https://');
  });
});

describe('EnvValidationError', () => {
  it('reports invalid keys without their values', () => {
    const error = errorOf({ ...valid, UPSTREAM_URL: 'ftp://user:hunter2@core/' });
    expect(error.message).toMatch(/^Invalid environment:/);
    expect(error.message).not.toContain('hunter2');
  });

  it('formats an issue with an empty path as (root)', () => {
    const error = new EnvValidationError([{ code: 'custom', message: 'Expected object', path: [], input: undefined }]);
    expect(error.message).toMatch(/^Invalid environment:\n\s+\(root\):/);
    expect(error.keys).toEqual(['']);
  });
});
