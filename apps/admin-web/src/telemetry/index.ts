/**
 * Browser telemetry (doc 20). The edge serves /telemetry.json from its environment: anything other than
 * `{"enabled":true}` (telemetry off, a 404, a network error, bad JSON) leaves Faro unloaded. Faro is a separate chunk,
 * so the main bundle doesn't grow and a deployment without telemetry never downloads it.
 */
import type { FaroSettings } from './faro';

const CONFIG_URL = '/telemetry.json';

export interface StartTelemetryOptions {
  readonly fetchFn?: typeof fetch;
  readonly loadFaro?: () => Promise<{ initFaro: (settings: FaroSettings) => void }>;
}

/** The environment when the edge reports telemetry on; null for every other answer. */
function readEnvironment(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('enabled' in body) || body.enabled !== true) return null;
  const environment = 'environment' in body && typeof body.environment === 'string' ? body.environment : '';
  return environment === '' ? 'unknown' : environment;
}

async function fetchEnvironment(fetchFn: typeof fetch): Promise<string | null> {
  const response = await fetchFn(CONFIG_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) return null;
  return readEnvironment(await response.json());
}

/** Resolves true when Faro started. Never rejects: telemetry must not break the app. */
export async function startTelemetry(options: StartTelemetryOptions = {}): Promise<boolean> {
  const { fetchFn = fetch, loadFaro = () => import('./faro') } = options;
  try {
    const environment = await fetchEnvironment(fetchFn);
    if (environment === null) return false;
    const { initFaro } = await loadFaro();
    initFaro({ environment });
    return true;
  } catch (error) {
    console.warn('admin-web: telemetry not started', error);
    return false;
  }
}
