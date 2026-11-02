import { register } from 'node:module';

import { type OtelConfig, resolveOtelConfig } from './otel-config.js';
import type { OtelProviders } from './otel-sdk.js';

export interface BootstrapDeps {
  /** Patches libraries imported after this point (ESM through import-in-the-middle, CJS through require hooks). */
  readonly registerLoaderHooks: () => Promise<void>;
  readonly startOtel: (config: OtelConfig) => Promise<OtelProviders>;
  readonly report: (message: string) => void;
  readonly onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
}

/**
 * portal-api is ESM, so its imports are patched by an import-in-the-middle loader hook: the in-thread
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
  // Loaded only when telemetry is on, so a disabled deployment never loads the SDK.
  startOtel: async (config) => (await import('./otel-sdk.js')).startOtel(config),
  // stderr directly: Nest's logger doesn't exist yet. Messages name keys, never values.
  report: (message) => console.error(`[instrumentation] ${message}`),
  onSignal: (signal, handler) => process.once(signal, handler),
};

/**
 * Starts OpenTelemetry when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise does nothing (no hooks, no SDK, no network).
 * Returns the providers when started, null when off. Buffered spans and logs are flushed, best effort, on SIGTERM/SIGINT
 * while Nest's shutdown hooks close the app.
 */
export async function bootstrapTelemetry(
  env: Readonly<Record<string, string | undefined>> = process.env,
  deps: BootstrapDeps = defaultDeps,
): Promise<OtelProviders | null> {
  const config = resolveOtelConfig(env, deps.report);
  if (!config) return null;
  await deps.registerLoaderHooks();
  const providers = await deps.startOtel(config);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    deps.onSignal(signal, () => {
      providers.shutdown().catch((error: unknown) => {
        deps.report(`flush on ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }
  return providers;
}
