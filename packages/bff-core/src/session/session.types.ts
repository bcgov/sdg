import type { OidcTokens, PendingAuthorization } from '@repo/auth';

export interface SessionUser {
  name: string;
  email: string | null;
}

export interface AuthenticatedSession {
  /** core-api's principal id for this user, from `/internal/principals/login` (KTD5). */
  principalId: string;
  user: SessionUser;
  /** Kept server-side for refresh, forwarding (Bearer) and logout (id_token_hint); never sent to the browser. */
  tokens: OidcTokens;
}

declare module 'express-session' {
  interface SessionData {
    /** Present only between /api/auth/login and /api/auth/callback. */
    oidc?: PendingAuthorization;
    auth?: AuthenticatedSession;
  }
}
