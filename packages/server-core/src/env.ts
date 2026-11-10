import { z } from 'zod';

/** A `z.preprocess(blankAsMissing, …)` wrapper around the schema `T`. */
export type BlankAsMissing<T extends z.ZodType> = z.ZodPreprocess<T>;

/** `'true' | 'false'` (default `'false'`) as a boolean. */
export type BooleanString = z.ZodPipe<
  z.ZodDefault<z.ZodEnum<{ true: 'true'; false: 'false' }>>,
  z.ZodTransform<boolean, 'true' | 'false'>
>;

/** A URL restricted to the given protocols. */
export type UrlWithProtocol = z.ZodURL;

/** A URL with its trailing slashes dropped. */
export type BaseUrl = z.ZodPipe<z.ZodURL, z.ZodTransform<string, string>>;

export function booleanString(): BooleanString {
  return z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true');
}

export function urlWithProtocol(protocols: readonly string[]): UrlWithProtocol {
  const schemes = protocols.map((protocol) => `${protocol}//`).join(' or ');
  return z.url().refine((value) => protocols.includes(new URL(value).protocol), { message: `Must use ${schemes}` });
}

/** Drops trailing slashes with a loop: the equivalent `/\/+$/` backtracks on long runs of slashes. */
export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/** A URL restricted to the given protocols, without trailing slashes (a base URL to append paths to). */
export function baseUrl(protocols: readonly string[]): BaseUrl {
  return urlWithProtocol(protocols).transform(withoutTrailingSlashes);
}

/** An unset or blank variable counts as missing, so `FOO=` in a .env file doesn't fail validation. */
export function blankAsMissing(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** The optional OpenTelemetry settings every service reads (`otelEnvShape`). */
export type OtelEnvShape = {
  OTEL_EXPORTER_OTLP_ENDPOINT: BlankAsMissing<z.ZodOptional<BaseUrl>>;
  OTEL_SERVICE_NAME: BlankAsMissing<z.ZodDefault<z.ZodString>>;
  OTEL_RESOURCE_ATTRIBUTES: BlankAsMissing<z.ZodOptional<z.ZodString>>;
  OTEL_TRACES_SAMPLER_ARG: BlankAsMissing<z.ZodDefault<z.ZodCoercedNumber>>;
};

/**
 * Optional OpenTelemetry settings (doc 20). No OTEL_EXPORTER_OTLP_ENDPOINT means telemetry is not wired up at all.
 * Each service's `src/instrumentation.ts` validates these on its own before Nest starts; spread the shape into the
 * service's env schema so Nest fails boot on the same invalid values. OTEL_SERVICE_NAME defaults to `serviceName`.
 */
export function otelEnvShape(serviceName: string): OtelEnvShape {
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(blankAsMissing, baseUrl(['http:', 'https:']).optional()),
    OTEL_SERVICE_NAME: z.preprocess(blankAsMissing, z.string().min(1).default(serviceName)),
    OTEL_RESOURCE_ATTRIBUTES: z.preprocess(blankAsMissing, z.string().optional()),
    OTEL_TRACES_SAMPLER_ARG: z.preprocess(blankAsMissing, z.coerce.number().min(0).max(1).default(1)),
  };
}

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The settings every Nest service reads: runtime mode, port, log level, proxy trust and OpenTelemetry. */
// Type aliases, not interfaces: z.object() needs a shape with an implicit index signature.
export type ServiceEnvShape = OtelEnvShape & {
  NODE_ENV: z.ZodDefault<z.ZodEnum<{ development: 'development'; test: 'test'; production: 'production' }>>;
  PORT: z.ZodDefault<z.ZodCoercedNumber>;
  LOG_LEVEL: z.ZodDefault<z.ZodEnum<{ [K in LogLevel]: K }>>;
  TRUST_PROXY: BooleanString;
};

/** Spread into a service's `z.object({ … })`: `z.object({ ...serviceEnvShape('core-api'), DATABASE_URL: … })`. */
export function serviceEnvShape(serviceName: string): ServiceEnvShape {
  return {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    TRUST_PROXY: booleanString(),
    ...otelEnvShape(serviceName),
  };
}

/** The parsed `serviceEnvShape`: what the shared Nest modules read from `ConfigService`. */
export type ServiceEnv = z.infer<z.ZodObject<ServiceEnvShape>>;

/** Thrown for an invalid environment. Lists each key with its problem, never the values. */
export class EnvValidationError extends Error {
  readonly keys: readonly string[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    super(`Invalid environment:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.keys = issues.map((issue) => issue.path.join('.'));
  }
}

/** A `@nestjs/config` validate hook that parses `process.env` (plus any .env file) with `schema`. */
export function createEnvValidator<T>(schema: z.ZodType<T>): (raw: Record<string, unknown>) => T {
  return (raw) => {
    const result = schema.safeParse(raw);
    if (!result.success) throw new EnvValidationError(result.error.issues);
    return result.data;
  };
}
