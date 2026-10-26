/** The authenticated user derived from verified OIDC / JWT claims. */
export interface AuthUser {
  issuer: string;
  subject: string;
  /** Display name: `name`, `given_name family_name`, `preferred_username`, `email`, then `sub`. */
  name: string;
  email: string | null;
  emailVerified: boolean;
  /** `preferred_username`. */
  username: string | null;
  claims: Readonly<Record<string, unknown>>;
}

/** Fetch-compatible function used for outbound HTTP requests (discovery, token, JWKS). */
export type AuthFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OidcClientOptions {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  /** Default `['openid', 'profile', 'email']`. */
  scopes?: readonly string[];
  /** Custom fetch for all IdP requests (tests, proxies). Defaults to the global `fetch`. */
  fetch?: AuthFetch;
  /** Allow plain `http:` IdP URLs. Only for local development and tests; never in deployed environments. */
  allowInsecureRequests?: boolean;
}

/** State kept server-side between the authorization request and the callback. */
export interface PendingAuthorization {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export interface OidcTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string | null;
  /** Access-token expiry as epoch milliseconds, when the IdP sent `expires_in`. */
  expiresAt: number | null;
}

export interface AuthorizationRequest {
  url: URL;
  pending: PendingAuthorization;
}

export interface CallbackResult {
  user: AuthUser;
  tokens: OidcTokens;
}

export interface OidcClient {
  /** Runs discovery (health/readiness). Caches success; retries after a failure. */
  discover(): Promise<void>;
  createAuthorizationRequest(returnTo: string): Promise<AuthorizationRequest>;
  handleCallback(callbackUrl: URL, pending: PendingAuthorization): Promise<CallbackResult>;
  buildEndSessionUrl(idToken: string | null): Promise<URL>;
}

export interface JwtVerifierOptions {
  issuerUrl: string;
  audience: string | readonly string[];
  /** Default 30 seconds. */
  clockToleranceSeconds?: number;
  /** Custom fetch for discovery and JWKS requests. Defaults to the global `fetch`. */
  fetch?: AuthFetch;
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthUser>;
}
