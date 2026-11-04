import type { z } from 'zod';

import { otelEnvSchema } from '../config/env.js';
import { isQuietPath } from '../http/quiet-paths.js';

/** What OTLP export needs; built only when an OTLP endpoint is configured (metrics don't need it, doc 21). */
export interface OtelConfig {
  /** OTLP/HTTP base URL without a trailing slash; signals go to `<endpoint>/v1/traces` and `<endpoint>/v1/logs`. */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly resourceAttributes: Readonly<Record<string, string>>;
  /** parentbased_traceidratio ratio, 0–1. */
  readonly samplerRatio: number;
}

/** `key=value,key2=value2` (values percent-encoded, per the OTel spec); malformed pairs are skipped. */
function parseResourceAttributes(raw: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const pair of raw?.split(',') ?? []) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const key = pair.slice(0, separator).trim();
    try {
      attributes[key] = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      // A broken percent-escape: skip this attribute rather than drop telemetry.
    }
  }
  return attributes;
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
}

/**
 * The single switch for OTLP export (traces and logs): null when OTEL_EXPORTER_OTLP_ENDPOINT is missing or the OTEL_*
 * settings are invalid. Invalid settings are reported by key, never by value. Metrics are on either way.
 */
export function resolveOtelConfig(
  raw: Readonly<Record<string, string | undefined>>,
  report: (message: string) => void = () => undefined,
): OtelConfig | null {
  const result = otelEnvSchema.safeParse(raw);
  if (!result.success) {
    report(`OpenTelemetry disabled, invalid settings: ${describeIssues(result.error.issues)}`);
    return null;
  }
  const env = result.data;
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) return null;
  return {
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: env.OTEL_SERVICE_NAME,
    resourceAttributes: parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES),
    samplerRatio: env.OTEL_TRACES_SAMPLER_ARG,
  };
}

/** Probes and scrapes are neither traced nor timed, matching the logging rule (isQuietPath). */
export function shouldTraceIncoming(url: string): boolean {
  return !isQuietPath(url);
}
