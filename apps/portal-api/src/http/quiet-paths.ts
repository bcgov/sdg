import { RELAY_STREAM_PATH } from '../notifications/relay-stream.path.js';

/** Escapes every regex metacharacter so the string matches literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Kubelet probes and Prometheus scrapes, which are high-frequency, and the relayed inbox stream, which stays open for
 * minutes (KTD4, KTD6): neither logged nor timed.
 */
const QUIET_PATH = new RegExp(
  `^/(?:metrics|healthz/[^/?]+|${escapeRegExp(RELAY_STREAM_PATH.replace(/^\//, ''))})/?(?:\\?|$)`,
);

export function isQuietPath(url: string): boolean {
  return QUIET_PATH.test(url);
}
