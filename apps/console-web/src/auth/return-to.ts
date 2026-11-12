/** Only a same-app path; console-api's login re-checks it (safeReturnTo) anyway. */
export function parseReturnTo(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
}
