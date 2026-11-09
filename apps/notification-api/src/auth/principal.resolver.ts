import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { isAuthError, type JwtVerifier } from '@repo/auth';

import { describeError } from '../logging/describe-error.js';
import { CREDENTIAL_DIRECTORY, type CredentialDirectory } from './directories.js';
import { classifyToken, type Principal, type TokenClients, type TokenKind } from './token-kind.js';

/** The verifier for KEYCLOAK_ISSUER_URL, accepting the audiences of KTD5. */
export const NOTIFICATION_JWT_VERIFIER = Symbol('NOTIFICATION_JWT_VERIFIER');
/** notification-api's own and relaying client ids, from the environment. */
export const TOKEN_CLIENTS = Symbol('TOKEN_CLIENTS');

/** The structural view of the HTTP request the guards read and write. */
export interface PrincipalRequest {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  principal?: Principal;
}

const BEARER = /^Bearer ([A-Za-z0-9\-_.~+/]+=*)$/;

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  return BEARER.exec(header)?.[1] ?? null;
}

/**
 * Verifies the request's bearer token and classifies it (KTD5). A missing, invalid or unclassifiable token is 401;
 * the issuer's keys being out of reach is 503; any other error that is no verdict on the token (e.g. the credential
 * lookup failing) is logged and rethrown.
 */
@Injectable()
export class PrincipalResolver {
  private readonly logger = new Logger(PrincipalResolver.name);
  private readonly verifier: JwtVerifier;
  private readonly clients: TokenClients;
  private readonly credentials: CredentialDirectory;

  constructor(
    @Inject(NOTIFICATION_JWT_VERIFIER) verifier: JwtVerifier,
    @Inject(TOKEN_CLIENTS) clients: TokenClients,
    @Inject(CREDENTIAL_DIRECTORY) credentials: CredentialDirectory,
  ) {
    this.verifier = verifier;
    this.clients = clients;
    this.credentials = credentials;
  }

  async resolve(request: PrincipalRequest): Promise<Principal> {
    if (request.principal) return request.principal;
    const token = bearerToken(request.headers['authorization']);
    if (token === null) throw new UnauthorizedException();
    try {
      const principal = await classifyToken(await this.verifier.verify(token), this.clients, this.credentials);
      if (principal === null) {
        this.logger.debug({ msg: 'Rejected bearer token: not a token kind notification-api accepts' });
        throw new UnauthorizedException();
      }
      request.principal = principal;
      return principal;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (isAuthError(error) && error.code === 'verifier_unavailable') {
        // No verdict on the token: 503 lets a client retry where a 401 would sign it out.
        this.logger.warn({
          msg: 'Could not verify the bearer token: issuer keys unavailable',
          error: describeError(error),
        });
        throw new ServiceUnavailableException();
      }
      if (isAuthError(error)) {
        this.logger.debug({ msg: 'Rejected bearer token', error: describeError(error) });
        throw new UnauthorizedException();
      }
      this.logger.error({ msg: 'Could not authenticate the bearer token', error: describeError(error) });
      throw error;
    }
  }

  /** The request's principal when its token is of `kind`; 401 for no accepted token, 403 for another kind. */
  async require<K extends TokenKind>(context: ExecutionContext, kind: K): Promise<Extract<Principal, { kind: K }>> {
    const principal = await this.resolve(context.switchToHttp().getRequest<PrincipalRequest>());
    if (!isKind(principal, kind)) throw new ForbiddenException();
    return principal;
  }
}

function isKind<K extends TokenKind>(principal: Principal, kind: K): principal is Extract<Principal, { kind: K }> {
  return principal.kind === kind;
}
