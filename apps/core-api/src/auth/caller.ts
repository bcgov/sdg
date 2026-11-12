import type { AuthUser } from '@repo/auth';

/** The Keycloak clients whose person tokens core-api accepts. */
export interface KeycloakClients {
  /** The portal (BCSC) client id. */
  portal: string;
  /** The console (IDIR) client id; undefined until console-api exists, and then no console-client token is accepted. */
  console: string | undefined;
}

/** The client role a console-client token needs for console routes and to sign in to console-web. */
export const ADMIN_ROLE = 'admin';

/** Who a verified token belongs to. Authorization by audience happens in the guards, not here. */
export type Caller =
  | { kind: 'portal-user'; user: AuthUser; token: string }
  | { kind: 'console-user'; user: AuthUser; token: string; isAdmin: boolean }
  | { kind: 'service-account'; user: AuthUser; token: string; clientId: string };

export type CallerKind = Caller['kind'];

/** The request as the resolver and guards see it: `caller` is set once the token is verified. */
export interface CallerRequest {
  headers: Record<string, string | string[] | undefined>;
  caller?: Caller;
}
