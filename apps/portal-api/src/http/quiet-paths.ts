/** Kubelet probes and Prometheus scrapes: high-frequency, so they are neither logged nor timed. */
const QUIET_PATH = /^\/(?:metrics|healthz\/[^/?]+)\/?(?:\?|$)/;

export function isQuietPath(url: string): boolean {
  return QUIET_PATH.test(url);
}
