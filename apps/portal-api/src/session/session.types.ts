import type { OidcTokens, PendingAuthorization } from '@repo/auth';

export interface SessionUser {
  name: string;
  email: string | null;
}

export interface AuthenticatedSession {
  principalId: string;
  user: SessionUser;
  /** Kept server-side for logout (id_token_hint) and future downstream calls; never sent to the browser. */
  tokens: OidcTokens;
}

declare module 'express-session' {
  interface SessionData {
    /** Present only between /api/auth/login and /api/auth/callback. */
    oidc?: PendingAuthorization;
    auth?: AuthenticatedSession;
    /**
     * Epoch milliseconds of the signed-in user's last request without `sdg-background: 1`, to within 5 minutes; the
     * idle limit (`SESSION_TTL_SECONDS`) counts from it (KTD8).
     */
    lastActivityAt?: number;
  }
}
