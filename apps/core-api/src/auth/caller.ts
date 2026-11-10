import type { AuthUser } from '@repo/auth';

/** The Keycloak clients whose person tokens core-api accepts (KTD13). */
export interface KeycloakClients {
  /** The portal (BCSC) client id. */
  portal: string;
  /** The admin (IDIR) client id; undefined until admin-api exists, and then no admin-client token is accepted. */
  admin: string | undefined;
}

/** The client role an admin-client token needs for admin routes and to sign in to admin-web (R9, R14). */
export const ADMIN_ROLE = 'admin';

/** Who a verified token belongs to (KTD4). Authorization by audience happens in the guards, not here. */
export type Caller =
  | { kind: 'portal-user'; user: AuthUser; token: string }
  | { kind: 'admin-user'; user: AuthUser; token: string; isAdmin: boolean }
  | { kind: 'service-account'; user: AuthUser; token: string; clientId: string };

export type CallerKind = Caller['kind'];

/** The request as the resolver and guards see it: `caller` is set once the token is verified. */
export interface CallerRequest {
  headers: Record<string, string | string[] | undefined>;
  caller?: Caller;
}
