import { register } from 'node:module';

import { type OtelConfig, resolveOtelConfig } from './otel-config.js';
import type { OtelHandle } from './otel-sdk.js';

export interface TelemetryOptions {
  /** The service's name: OTEL_SERVICE_NAME's default, and the metrics resource's name without OTLP export. */
  readonly serviceName: string;
  /** Read for the OTEL_* settings; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface BootstrapDeps {
  /** Patches libraries imported after this point (ESM through import-in-the-middle, CJS through require hooks). */
  readonly registerLoaderHooks: () => Promise<void>;
  /** null: metrics only (no OTLP export). */
  readonly startOtel: (serviceName: string, config: OtelConfig | null) => Promise<OtelHandle>;
  readonly report: (message: string) => void;
  readonly onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

/**
 * The services are ESM, so their imports are patched by an import-in-the-middle loader hook: the in-thread
 * module.registerHooks() loader where Node supports it (module.register() is deprecated from Node 26), the
 * off-thread one otherwise.
 */
async function registerLoaderHooks(): Promise<void> {
  const iitm = await import('import-in-the-middle/register-hooks.mjs');
  if (iitm.supportsSyncHooks()) iitm.register();
  else register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
}

export const defaultDeps: BootstrapDeps = {
  registerLoaderHooks,
  // Imported after the loader hooks are registered, so the SDK's own imports are hooked too.
  startOtel: async (serviceName, config) => (await import('./otel-sdk.js')).startOtel(serviceName, config),
  // stderr directly: Nest's logger doesn't exist yet. Messages name keys, never values.
  report: (message) => console.error(`[instrumentation] ${message}`),
  onSignal: (signal, handler) => process.once(signal, handler),
};

/**
 * Always starts OpenTelemetry (doc 21): metrics are served on /metrics in every deployment. Traces and logs are
 * exported only when OTEL_EXPORTER_OTLP_ENDPOINT is set and valid; invalid OTEL_* settings are reported by key and
 * leave metrics on. Buffered telemetry is flushed, best effort, on SIGTERM/SIGINT while Nest's shutdown hooks close
 * the app.
 */
export async function bootstrapTelemetry(
  options: TelemetryOptions,
  deps: BootstrapDeps = defaultDeps,
): Promise<OtelHandle> {
  const config = resolveOtelConfig(options.env ?? process.env, options.serviceName, deps.report);
  await deps.registerLoaderHooks();
  const handle = await deps.startOtel(options.serviceName, config);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    deps.onSignal(signal, () => {
      handle.shutdown().catch((error: unknown) => {
        deps.report(`flush on ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }
  return handle;
}
