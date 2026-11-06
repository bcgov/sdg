/**
 * Kubelet probes and Prometheus scrapes, which are high-frequency, and the inbox stream, which stays open for minutes
 * (KTD4): neither logged nor timed.
 */
const QUIET_PATH = /^\/(?:metrics|healthz\/[^/?]+|api\/v1\/me\/inbox\/stream)\/?(?:\?|$)/;

export function isQuietPath(url: string): boolean {
  return QUIET_PATH.test(url);
}
