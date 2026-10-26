/** C0 controls, DEL and C1 controls. */
function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
const PROBE_ORIGIN = 'http://return-to.invalid';

/**
 * Returns `value` only when it is a same-origin relative path: it starts with a single `/`
 * (not `//` or `/\`), has no scheme and no control characters. Anything else returns `fallback`.
 */
export function safeReturnTo(value: unknown, fallback: string = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\') || hasControlChars(value)) return fallback;
  // Belt and braces: the WHATWG parser must resolve it against our own origin.
  if (new URL(value, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return fallback;
  return value;
}
