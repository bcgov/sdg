import type { ProfileResponse } from './profile.schemas.js';

type Claims = Readonly<Record<string, unknown>>;

/** A trimmed, non-empty string claim, or `null`. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Non-empty trimmed lines of a multi-line value. */
function lines(value: unknown): string[] {
  const whole = text(value);
  return whole === null ? [] : whole.split(/\r?\n/u).flatMap((line) => text(line) ?? []);
}

/** The `name` claim, else given and family names joined; never a username, email or subject (R13). */
function fullName(claims: Claims): string | null {
  const name = text(claims['name']);
  if (name !== null) return name;
  const parts = [text(claims['given_name']), text(claims['family_name'])].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(' ');
}

/** A JSON object claim, such as OIDC's structured `address`. */
function isClaims(value: unknown): value is Claims {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** OIDC address claim (Core 5.1.1) as display lines: `formatted`, else its parts; `null` when nothing is usable. */
function addressLines(address: unknown): string[] | null {
  if (!isClaims(address)) return null;
  const formatted = lines(address['formatted']);
  if (formatted.length > 0) return formatted;
  const cityLine = [text(address['locality']), text(address['region'])].filter((part) => part !== null).join(' ');
  const built = [
    ...lines(address['street_address']),
    ...(cityLine === '' ? [] : [cityLine]),
    ...lines(address['postal_code']),
    ...lines(address['country']),
  ];
  return built.length === 0 ? null : built;
}

/** Maps userinfo claims to the profile Settings shows (KTD4). */
export function profileView(claims: Claims): ProfileResponse {
  return {
    name: fullName(claims),
    email: text(claims['email']),
    phoneNumber: text(claims['phone_number']),
    birthdate: text(claims['birthdate']),
    gender: text(claims['gender']),
    address: addressLines(claims['address']),
  };
}
