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
  /**
   * Redeems `current.refreshToken` (refresh grant) for new tokens. The previous ID token and refresh token are kept
   * when the response omits them. Throws `AuthError('refresh_failed')` when there is no refresh token or the IdP
   * rejects it (`detail` carries the IdP `error` code).
   */
  refresh(current: OidcTokens): Promise<OidcTokens>;
  /**
   * Ends the user's IdP session over the back channel: posts `current.refreshToken` with the client credentials to the
   * discovered `end_session_endpoint` (Keycloak's logout endpoint). Throws `AuthError('end_session_failed')` when there
   * is no refresh token or the IdP answers with an error (`detail` carries its `error` code, or the HTTP status).
   */
  endSession(current: OidcTokens): Promise<void>;
}

/**
 * Decides whether a token's audience is accepted, from its verified claims (signature, `iss`, `exp` and `nbf` already
 * checked). Lets the accepted audiences change without rebuilding the verifier. `false` rejects the token as
 * `invalid_token`; a thrown error rejects `verify` with that error unchanged.
 */
export type AudiencePredicate = (claims: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;

export interface JwtVerifierOptions {
  issuerUrl: string;
  /** The accepted `aud` value(s), any of which must be present; or a predicate over the verified claims. */
  audience: string | readonly string[] | AudiencePredicate;
  /** Default 30 seconds. */
  clockToleranceSeconds?: number;
  /** Custom fetch for discovery and JWKS requests. Defaults to the global `fetch`. */
  fetch?: AuthFetch;
}

export interface JwtVerifier {
  verify(token: string): Promise<AuthUser>;
}
