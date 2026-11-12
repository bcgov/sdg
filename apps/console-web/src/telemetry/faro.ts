import { getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

export interface FaroSettings {
  /** pr-<n>, test, prod or local, from the edge's /telemetry.json. */
  readonly environment: string;
}

/** Same origin as the app: the edge proxies it to Alloy's Faro receiver, so the CSP keeps connect-src 'self'. */
export const COLLECT_URL = '/collect';

/**
 * Errors, console errors, web vitals, sessions and fetch/XHR traces. Trace context (traceparent) goes only to
 * same-origin requests (OTel's default for fetch/XHR), i.e. /api via the edge, never to another origin.
 */
export function initFaro({ environment }: FaroSettings): void {
  initializeFaro({
    url: COLLECT_URL,
    app: { name: 'console-web', environment },
    instrumentations: [
      ...getWebInstrumentations(),
      new TracingInstrumentation({ instrumentationOptions: { propagateTraceHeaderCorsUrls: [] } }),
    ],
  });
}
