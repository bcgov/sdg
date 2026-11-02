/**
 * Preloaded with `node --import ./dist/instrumentation.js dist/main.js` (Dockerfile, Helm chart, compose), so it runs
 * before Nest, Express, pg and pino are first imported. Without OTEL_EXPORTER_OTLP_ENDPOINT it does nothing: no loader
 * hook, no SDK modules loaded, no network calls (doc 20, "missing config means not wired up").
 */
import { register } from 'node:module';

import { resolveOtelConfig } from './telemetry/otel-config.js';

// stderr directly: Nest's logger doesn't exist yet. Never logs values, only keys.
const config = resolveOtelConfig(process.env, (message) => console.error(`[instrumentation] ${message}`));

if (config) {
  // portal-api is ESM: libraries it imports are patched through an import-in-the-middle loader hook; CommonJS
  // dependencies loaded with require() are patched by require-in-the-middle. The in-thread module.registerHooks()
  // loader where Node supports it (module.register() is deprecated from Node 26), the off-thread one otherwise.
  const iitm = await import('import-in-the-middle/register-hooks.mjs');
  if (iitm.supportsSyncHooks()) iitm.register();
  else register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const { startOtel } = await import('./telemetry/otel-sdk.js');
  const providers = startOtel(config);
  // Best effort: flush buffered spans and logs while Nest's shutdown hooks close the app.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      providers.shutdown().catch((error: unknown) => {
        console.error(
          `[instrumentation] flush on ${signal} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }
}
