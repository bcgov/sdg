import { Logger } from '@nestjs/common';
import type { OidcClient } from '@repo/auth';
import type { LoginRefusal } from '@repo/bff-core/nestjs';
import { describeError } from '@repo/server-core';

export const NOT_AUTHORIZED_PATH = '/not-authorized';

export interface NotAuthorizedOptions {
  readonly appUrl: string;
  /**
   * The OIDC client bff-core signed the user in with. A getter, because bff-core builds that client from the very
   * options this hook is part of.
   */
  readonly oidc: () => OidcClient;
}

/**
 * core-api answers 403 at the principal upsert to a console-client token without the admin role, and bff-core
 * keeps no session. This hook then ends the user's Keycloak session over the back channel, so the next sign-in asks
 * for credentials again instead of silently reusing the refused one, and sends the browser to the not-authorized page.
 * A failed back-channel logout is logged and the browser still goes there; the page's sign-out finishes the job.
 */
export function notAuthorizedRefusal({ appUrl, oidc }: NotAuthorizedOptions): LoginRefusal {
  const logger = new Logger('NotAuthorized');
  return async (login) => {
    try {
      await oidc().endSession(login.tokens);
    } catch (error) {
      logger.warn({ msg: 'Could not end the Keycloak session of a refused sign-in', error: describeError(error) });
    }
    return `${appUrl}${NOT_AUTHORIZED_PATH}`;
  };
}
