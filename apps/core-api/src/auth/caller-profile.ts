import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '@repo/auth';
import { describeError } from '@repo/server-core';

import type { Caller } from './caller.js';
import { UserinfoError, type UserinfoClient } from './userinfo.client.js';

interface ProfileLogger {
  warn: (message: unknown) => void;
  error: (message: unknown) => void;
}

/**
 * The caller's profile from userinfo, with the failure mapping every userinfo-backed route shares: Keycloak refusing the
 * token is 401, an outage or an answer for another subject is 503 with `unavailableMessage`. Logs errors, never claims.
 */
export async function readCallerProfile(
  userinfo: UserinfoClient,
  caller: Caller,
  logger: ProfileLogger,
  unavailableMessage: string,
): Promise<AuthUser> {
  try {
    return await userinfo.profile(caller.token, caller.user);
  } catch (error) {
    if (!(error instanceof UserinfoError)) throw error;
    if (error.reason === 'rejected') {
      logger.warn({ msg: 'Keycloak refused a verified token at userinfo', error: describeError(error) });
      throw new UnauthorizedException();
    }
    logger.error({ msg: 'Could not read the caller’s profile from userinfo', error: describeError(error) });
    throw new ServiceUnavailableException(unavailableMessage);
  }
}
