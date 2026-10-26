import { AuthError } from './errors.js';
import type { AuthUser } from './types.js';

function stringClaim(claims: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = claims[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function displayName(claims: Readonly<Record<string, unknown>>, subject: string): string {
  const fullName = [stringClaim(claims, 'given_name'), stringClaim(claims, 'family_name')]
    .filter((part) => part !== null)
    .join(' ')
    .trim();
  return (
    stringClaim(claims, 'name') ??
    (fullName === '' ? null : fullName) ??
    stringClaim(claims, 'preferred_username') ??
    stringClaim(claims, 'email') ??
    subject
  );
}

/** Maps verified ID-token / access-token claims to an `AuthUser`. Throws `AuthError('callback_failed')` without `iss`/`sub`. */
export function claimsToAuthUser(claims: Readonly<Record<string, unknown>>): AuthUser {
  const issuer = stringClaim(claims, 'iss');
  const subject = stringClaim(claims, 'sub');
  if (issuer === null || subject === null) {
    throw new AuthError('callback_failed', { detail: 'missing iss or sub claim' });
  }
  return {
    issuer,
    subject,
    name: displayName(claims, subject),
    email: stringClaim(claims, 'email'),
    emailVerified: claims['email_verified'] === true,
    username: stringClaim(claims, 'preferred_username'),
    claims: Object.freeze({ ...claims }),
  };
}
