import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { TracerProvider } from '@opentelemetry/sdk-trace';
import { describe, expect, it, vi } from 'vitest';

import { type BootstrapDeps, bootstrapTelemetry } from './bootstrap.js';
import type { OtelProviders } from './otel-sdk.js';

function fakeDeps(shutdown: OtelProviders['shutdown'] = async () => undefined) {
  const handlers = new Map<string, () => void>();
  const deps = {
    registerLoaderHooks: vi.fn<BootstrapDeps['registerLoaderHooks']>(async () => undefined),
    startOtel: vi.fn<BootstrapDeps['startOtel']>(async () => ({
      tracerProvider: new TracerProvider(),
      loggerProvider: new LoggerProvider(),
      shutdown,
    })),
    report: vi.fn<BootstrapDeps['report']>(),
    onSignal: vi.fn<BootstrapDeps['onSignal']>((signal, handler) => {
      handlers.set(signal, handler);
    }),
  };
  return { deps, handlers };
}

describe('bootstrapTelemetry', () => {
  it('does nothing without OTEL_EXPORTER_OTLP_ENDPOINT: no hooks, no SDK, no signal handlers', async () => {
    const { deps } = fakeDeps();
    await expect(bootstrapTelemetry({}, deps)).resolves.toBeNull();
    expect(deps.registerLoaderHooks).not.toHaveBeenCalled();
    expect(deps.startOtel).not.toHaveBeenCalled();
    expect(deps.onSignal).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('reports invalid settings by key and starts nothing', async () => {
    const { deps } = fakeDeps();
    await expect(bootstrapTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'grpc://secret-host' }, deps)).resolves.toBeNull();
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(String(deps.report.mock.calls[0]?.[0])).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(String(deps.report.mock.calls[0]?.[0])).not.toContain('secret-host');
    expect(deps.startOtel).not.toHaveBeenCalled();
  });

  it('registers the loader hooks before starting the SDK with the resolved config', async () => {
    const { deps } = fakeDeps();
    const order: string[] = [];
    deps.registerLoaderHooks.mockImplementation(async () => {
      order.push('hooks');
    });
    const started = deps.startOtel.getMockImplementation()!;
    deps.startOtel.mockImplementation(async (config) => {
      order.push('sdk');
      return started(config);
    });
    const providers = await bootstrapTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318' }, deps);
    expect(providers).not.toBeNull();
    expect(order).toEqual(['hooks', 'sdk']);
    expect(deps.startOtel).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://alloy:4318', serviceName: 'portal-api' }),
    );
  });

  it('flushes on SIGTERM and SIGINT and reports a failed flush', async () => {
    const shutdown = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('exporter down'));
    const { deps, handlers } = fakeDeps(shutdown);
    await bootstrapTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318' }, deps);
    expect([...handlers.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.();
    await vi.waitFor(() => expect(deps.report).toHaveBeenCalledWith('flush on SIGINT failed: exporter down'));
    expect(shutdown).toHaveBeenCalledTimes(2);
  });
});
