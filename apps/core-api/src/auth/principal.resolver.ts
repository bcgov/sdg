import {
  type HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  clientRoles,
  type AuthError,
  isAuthError,
  isServiceAccount,
  type AudiencePredicate,
  type AuthUser,
  type JwtVerifier,
} from '@repo/auth';
import { JWT_VERIFIER } from '@repo/auth/nestjs';
import { describeError } from '@repo/server-core';

import { ADMIN_ROLE, type Caller, type CallerKind, type CallerRequest, type KeycloakClients } from './caller.js';

/** Injection token for the `KeycloakClients` core-api accepts person tokens from. */
export const KEYCLOAK_CLIENTS: unique symbol = Symbol('KEYCLOAK_CLIENTS');

const BEARER = /^Bearer ([A-Za-z0-9\-_.~+/]+=*)$/;

type Claims = Readonly<Record<string, unknown>>;

const stringClaim = (claims: Claims, key: string): string | undefined => {
  const value = claims[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * Who a verified token belongs to: any client-credentials token is a service account (checked first, so a
 * service-account token from the portal client is never taken for a resident); otherwise the token's `azp` must be
 * the portal or the console client. Undefined for anything else.
 */
export function callerKind(claims: Claims, clients: KeycloakClients): CallerKind | undefined {
  if (isServiceAccount(claims)) return 'service-account';
  const azp = stringClaim(claims, 'azp');
  if (azp === undefined) return undefined;
  if (azp === clients.portal) return 'portal-user';
  if (clients.console !== undefined && azp === clients.console) return 'console-user';
  return undefined;
}

/** The verifier's audience predicate: the tokens `callerKind` can classify. No lookup, so it never throws. */
export function acceptedClaims(clients: KeycloakClients): AudiencePredicate {
  return (claims) => callerKind(claims, clients) !== undefined;
}

function toCaller(user: AuthUser, token: string, clients: KeycloakClients): Caller | undefined {
  const kind = callerKind(user.claims, clients);
  switch (kind) {
    case 'portal-user':
      return { kind, user, token };
    case 'console-user': {
      const roles = clients.console === undefined ? [] : clientRoles(user.claims, clients.console);
      return { kind, user, token, isAdmin: roles.includes(ADMIN_ROLE) };
    }
    case 'service-account': {
      const clientId = stringClaim(user.claims, 'azp') ?? stringClaim(user.claims, 'client_id');
      return clientId === undefined ? undefined : { kind, user, token, clientId };
    }
    default:
      return undefined;
  }
}

function bearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  return BEARER.exec(header)?.[1];
}

/**
 * Verifies the forwarded Bearer token and classifies its caller, once per request. 401 for a missing or
 * invalid token; 503 when Keycloak's signing keys cannot be fetched. Audience checks are the guards' job.
 */
@Injectable()
export class PrincipalResolver {
  private readonly logger = new Logger(PrincipalResolver.name);
  private readonly verifier: JwtVerifier;
  private readonly clients: KeycloakClients;

  constructor(@Inject(JWT_VERIFIER) verifier: JwtVerifier, @Inject(KEYCLOAK_CLIENTS) clients: KeycloakClients) {
    this.verifier = verifier;
    this.clients = clients;
  }

  async resolve(request: CallerRequest): Promise<Caller> {
    if (request.caller) return request.caller;
    const token = bearerToken(request.headers['authorization']);
    if (token === undefined) {
      this.logger.debug('Rejected request: missing or malformed Authorization header');
      throw new UnauthorizedException();
    }
    let user: AuthUser;
    try {
      user = await this.verifier.verify(token);
    } catch (error) {
      if (!isAuthError(error)) {
        this.logger.error({ msg: 'Token verification failed unexpectedly', error: describeError(error) });
        throw error;
      }
      throw this.verificationFailure(error);
    }
    const caller = toCaller(user, token, this.clients);
    if (caller === undefined) {
      this.logger.debug('Rejected token: no client id to classify it by');
      throw new UnauthorizedException();
    }
    request.caller = caller;
    return caller;
  }

  /** The HTTP answer to a token core-api could not verify. */
  private verificationFailure(error: AuthError): HttpException {
    if (error.code === 'verifier_unavailable') {
      this.logger.warn({ msg: 'Keycloak signing keys are unavailable', error: describeError(error) });
      return new ServiceUnavailableException('Token verification is temporarily unavailable');
    }
    this.logger.debug({ msg: 'Rejected bearer token', error: describeError(error) });
    return new UnauthorizedException();
  }
}
