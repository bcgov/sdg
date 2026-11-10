import { context, logs, metrics, propagation, trace } from '@opentelemetry/api';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { defaultDeps } from './bootstrap.js';
import type { OtelHandle } from './otel-sdk.js';
import { prometheusExporter } from './prometheus.js';

// The production wiring behind bootstrapTelemetry (its own file: it registers loader hooks and globals in this worker).
let handle: OtelHandle | undefined;

afterAll(async () => {
  await handle?.shutdown();
  metrics.disable();
  trace.disable();
  logs.disable();
  propagation.disable();
  context.disable();
});

describe('bootstrapTelemetry default dependencies', () => {
  it('reports to stderr with an [instrumentation] prefix', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultDeps.report('OpenTelemetry disabled, invalid settings: OTEL_TRACES_SAMPLER_ARG');
    expect(error).toHaveBeenCalledWith(
      '[instrumentation] OpenTelemetry disabled, invalid settings: OTEL_TRACES_SAMPLER_ARG',
    );
    error.mockRestore();
  });

  it('registers a one-shot process signal handler', () => {
    const before = process.listenerCount('SIGUSR2');
    const handler = vi.fn<() => void>();
    defaultDeps.onSignal('SIGUSR2', handler);
    expect(process.listenerCount('SIGUSR2')).toBe(before + 1);
    process.emit('SIGUSR2');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('SIGUSR2')).toBe(before);
  });

  it('registers the loader hooks without throwing', async () => {
    await expect(defaultDeps.registerLoaderHooks()).resolves.toBeUndefined();
  });

  it('loads the SDK lazily and starts it, bound to the process-wide Prometheus exporter', async () => {
    // Ratio 0: nothing is sampled, so nothing is exported to the unreachable endpoint on shutdown.
    handle = await defaultDeps.startOtel('core-api', {
      endpoint: 'http://127.0.0.1:9',
      serviceName: 'core-api',
      resourceAttributes: {},
      samplerRatio: 0,
    });
    expect(handle.exportsTelemetry).toBe(true);
    const { errors, resourceMetrics } = await prometheusExporter.collect();
    expect(errors).toEqual([]);
    const names = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics.map((m) => m.descriptor.name));
    expect(names).toContain('process.memory.usage');
  }, 30_000);
});
