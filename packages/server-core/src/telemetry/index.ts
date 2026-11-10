// Statically imports only the bootstrap and its config parsing: the SDK and the instrumentations load lazily, after
// the loader hooks are registered (bootstrap.ts).
export { bootstrapTelemetry, type BootstrapDeps, type TelemetryOptions } from './bootstrap.js';
export { resolveOtelConfig, shouldTraceIncoming, type OtelConfig } from './otel-config.js';
export type { OtelHandle } from './otel-sdk.js';
