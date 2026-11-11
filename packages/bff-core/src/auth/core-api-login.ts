import type { CallbackResult } from '@repo/auth';
import { z } from 'zod';

/** core-api's answer to a sign-in. */
export type LoginOutcome =
  /**
   * The principal exists (created or refreshed); the BFF creates the session. `name` and `email` are the profile
   * core-api read from Keycloak userinfo; the session shows them, falling back to the ID token's claims only
   * for a field core-api left out.
   */
  | {
      readonly kind: 'accepted';
      readonly principalId: string;
      readonly name?: string;
      readonly email?: string | null;
    }
  /** core-api refused the user (403), e.g. an admin-client token without the admin role. No session is created. */
  | { readonly kind: 'refused' }
  /** core-api was unreachable, timed out or answered 503; the web app offers a retry (`authError=unavailable`). */
  | { readonly kind: 'unavailable'; readonly cause: unknown };

/** Runs after the code exchange, before any session exists. Throwing fails the login (`authError=login_failed`). */
export type LoginHook = (login: CallbackResult) => Promise<LoginOutcome>;

/** Upper bound for the principal upsert at sign-in. */
export const CORE_API_LOGIN_TIMEOUT_MS = 10_000;

/** The route core-api's principal upsert lives on; `/internal/*` is never forwarded. */
export const PRINCIPALS_LOGIN_PATH = '/internal/principals/login';

export interface CoreApiLoginOptions {
  /** core-api's base URL, without a trailing slash. */
  readonly coreApiUrl: string;
  /** Defaults to CORE_API_LOGIN_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

const principalSchema = z.object({
  principalId: z.uuid(),
  name: z.string().optional(),
  email: z.string().nullable().optional(),
});

/** A non-2xx core-api answer other than 403 and 503, which fails the login. */
export class CoreApiLoginError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`core-api answered ${status} to the principal login`);
    this.name = 'CoreApiLoginError';
    this.status = status;
  }
}

async function interpret(response: Response): Promise<LoginOutcome> {
  if (response.status === 403) return { kind: 'refused' };
  if (response.status === 503) {
    return { kind: 'unavailable', cause: new Error('core-api answered 503 to the principal login') };
  }
  if (!response.ok) throw new CoreApiLoginError(response.status);
  const { principalId, name, email } = principalSchema.parse(await response.json());
  return { kind: 'accepted', principalId, name, email };
}

/**
 * The default `onLogin` hook: POSTs the fresh access token to core-api's `/internal/principals/login`,
 * which upserts the principal from the verified token and Keycloak userinfo and answers
 * `{ principalId, name, email }`.
 */
export function createCoreApiLogin(options: CoreApiLoginOptions): LoginHook {
  const timeoutMs = options.timeoutMs ?? CORE_API_LOGIN_TIMEOUT_MS;
  return async (login) => {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${options.coreApiUrl}${PRINCIPALS_LOGIN_PATH}`, {
        method: 'POST',
        headers: { accept: 'application/json', authorization: `Bearer ${login.tokens.accessToken}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { kind: 'unavailable', cause: error };
    }
    return interpret(response);
  };
}
