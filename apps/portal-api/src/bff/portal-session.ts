// portal-api's session identity, kept apart from Nest so the sessions migration entry (src/migrate.ts) loads only this.

/** portal-api's session cookie (R7); admin-api has its own. */
export const SESSION_COOKIE = 'portal.sid';
/** The HKDF info string keying the stored sessions' encryption; unchanged from the pre-bff-core sessions. */
export const SESSION_KEY_INFO = 'portal-session-store';
/** portal-api's own schema and migrations journal (KTD8, KTD9): the `portal` login owns both. */
export const SESSION_SCHEMA = 'portal';
