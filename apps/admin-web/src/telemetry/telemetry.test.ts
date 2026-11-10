import { afterEach, describe, expect, it, vi } from 'vitest';

import { startTelemetry } from '.';

const sdk = vi.hoisted(() => ({
  initializeFaro: vi.fn<(config: Record<string, unknown>) => void>(),
  getWebInstrumentations: vi.fn<() => string[]>(() => ['web-instrumentations']),
  tracingOptions: vi.fn<(options: unknown) => void>(),
}));

vi.mock('@grafana/faro-web-sdk', () => ({
  initializeFaro: sdk.initializeFaro,
  getWebInstrumentations: sdk.getWebInstrumentations,
}));
vi.mock('@grafana/faro-web-tracing', () => ({
  // A plain function works with `new` and records the options it was constructed with.
  TracingInstrumentation: vi.fn<(options: unknown) => void>(function TracingInstrumentation(options) {
    sdk.tracingOptions(options);
  }),
}));

const fetchFn = vi.fn<typeof fetch>();
const loadFaro = vi.fn<() => Promise<typeof import('./faro')>>(() => import('./faro'));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('startTelemetry', () => {
  describe('missing or disabled config', () => {
    it('does not load Faro when /telemetry.json returns {"enabled":false}', async () => {
      fetchFn.mockResolvedValue(Response.json({ enabled: false }));
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(false);
      expect(fetchFn).toHaveBeenCalledWith('/telemetry.json', { credentials: 'same-origin', cache: 'no-store' });
      expect(loadFaro).not.toHaveBeenCalled();
    });

    it('does not load Faro when /telemetry.json is 404', async () => {
      fetchFn.mockResolvedValue(new Response('not found', { status: 404 }));
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(false);
      expect(loadFaro).not.toHaveBeenCalled();
      expect(sdk.initializeFaro).not.toHaveBeenCalled();
    });

    it('does not load Faro and does not throw on a network error or invalid JSON', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fetchFn.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(false);
      fetchFn.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(false);
      expect(loadFaro).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('enabled', () => {
    it('initialises Faro with url /collect, app name admin-web and the environment from config', async () => {
      fetchFn.mockResolvedValue(Response.json({ enabled: true, environment: 'pr-12' }));
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(true);
      expect(sdk.initializeFaro).toHaveBeenCalledTimes(1);
      const config = sdk.initializeFaro.mock.calls[0]?.[0];
      expect(config?.url).toBe('/collect');
      expect(config?.app).toEqual({ name: 'admin-web', environment: 'pr-12' });
      expect(config?.instrumentations).toEqual(expect.arrayContaining(['web-instrumentations']));
    });

    it('propagates trace context only to same-origin /api requests', async () => {
      fetchFn.mockResolvedValue(Response.json({ enabled: true, environment: 'test' }));
      await startTelemetry({ fetchFn, loadFaro });
      expect(sdk.tracingOptions).toHaveBeenCalledWith({
        instrumentationOptions: { propagateTraceHeaderCorsUrls: [] },
      });
    });

    it('swallows a Faro initialisation error and leaves the app running', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      fetchFn.mockResolvedValue(Response.json({ enabled: true }));
      sdk.initializeFaro.mockImplementationOnce(() => {
        throw new Error('storage blocked');
      });
      await expect(startTelemetry({ fetchFn, loadFaro })).resolves.toBe(false);
      expect(loadFaro).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('admin-web: telemetry not started', expect.any(Error));
    });
  });
});
