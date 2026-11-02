import { context, logs, propagation, trace } from '@opentelemetry/api';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { defaultDeps } from './bootstrap.js';
import type { OtelProviders } from './otel-sdk.js';

// The production wiring behind bootstrapTelemetry (its own file: it registers loader hooks and globals in this worker).
let providers: OtelProviders | undefined;

afterAll(async () => {
  await providers?.shutdown();
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

  it('loads the SDK lazily and starts it', async () => {
    // Ratio 0: nothing is sampled, so nothing is exported to the unreachable endpoint on shutdown.
    providers = await defaultDeps.startOtel({
      endpoint: 'http://127.0.0.1:9',
      serviceName: 'portal-api',
      resourceAttributes: {},
      samplerRatio: 0,
    });
    expect(logs.getLoggerProvider()).toBe(providers.loggerProvider);
    expect(typeof providers.shutdown).toBe('function');
  });
});
