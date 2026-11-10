// admin-api's session identity, kept apart from Nest so the sessions migration entry (src/migrate.ts) loads only this.

/** admin-api's session cookie; portal-api has its own (`portal.sid`), which admin-api never reads. */
export const SESSION_COOKIE = 'admin.sid';
/**
 * The HKDF info string keying the stored sessions' encryption. Changing it makes every stored session unreadable,
 * which signs everyone out.
 */
export const SESSION_KEY_INFO = 'admin-session-store';
/** admin-api's own schema and migrations journal: the `admin` login owns both. */
export const SESSION_SCHEMA = 'admin';
