// console-api's session identity, kept apart from Nest so the sessions migration entry (src/migrate.ts) loads only this.

/** console-api's session cookie; portal-api has its own (`portal.sid`), which console-api never reads. */
export const SESSION_COOKIE = 'console.sid';
/**
 * The HKDF info string keying the stored sessions' encryption. Changing it makes every stored session unreadable,
 * which signs everyone out.
 */
export const SESSION_KEY_INFO = 'console-session-store';
/** console-api's own schema and migrations journal: the `console` login owns both. */
export const SESSION_SCHEMA = 'console';
