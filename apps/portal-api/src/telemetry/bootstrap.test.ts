import { describe, expect, it, vi } from 'vitest';

import { type BootstrapDeps, bootstrapTelemetry } from './bootstrap.js';
import type { OtelHandle } from './otel-sdk.js';

function fakeDeps(shutdown: OtelHandle['shutdown'] = async () => undefined) {
  const handlers = new Map<string, () => void>();
  const deps = {
    registerLoaderHooks: vi.fn<BootstrapDeps['registerLoaderHooks']>(async () => undefined),
    startOtel: vi.fn<BootstrapDeps['startOtel']>(async (config) => ({ exportsTelemetry: config !== null, shutdown })),
    report: vi.fn<BootstrapDeps['report']>(),
    onSignal: vi.fn<BootstrapDeps['onSignal']>((signal, handler) => {
      handlers.set(signal, handler);
    }),
  };
  return { deps, handlers };
}

describe('bootstrapTelemetry', () => {
  it('starts the SDK for metrics only without OTEL_EXPORTER_OTLP_ENDPOINT', async () => {
    const { deps, handlers } = fakeDeps();
    const handle = await bootstrapTelemetry({}, deps);
    expect(handle.exportsTelemetry).toBe(false);
    expect(deps.registerLoaderHooks).toHaveBeenCalledTimes(1);
    expect(deps.startOtel).toHaveBeenCalledWith(null);
    expect([...handlers.keys()]).toEqual(['SIGTERM', 'SIGINT']);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('reports invalid settings by key and still starts the SDK for metrics only', async () => {
    const { deps } = fakeDeps();
    const handle = await bootstrapTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'grpc://secret-host' }, deps);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(String(deps.report.mock.calls[0]?.[0])).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(String(deps.report.mock.calls[0]?.[0])).not.toContain('secret-host');
    expect(deps.startOtel).toHaveBeenCalledWith(null);
    expect(handle.exportsTelemetry).toBe(false);
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
    const handle = await bootstrapTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://alloy:4318' }, deps);
    expect(handle.exportsTelemetry).toBe(true);
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
