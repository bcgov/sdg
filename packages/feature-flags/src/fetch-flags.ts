/** Evaluated flags as core-api lists them: each flag that is on for the caller maps to `true`. */
export type FlagValues = Readonly<Record<string, boolean>>;

export const FLAGS_PATH = '/api/v1/shared/flags';

function isFlagValues(value: unknown): value is FlagValues {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((enabled) => typeof enabled === 'boolean')
  );
}

/** Any failure throws: a non-OK answer, a body that isn't JSON, or one that isn't a flag map. */
export async function fetchFlags(): Promise<FlagValues> {
  const response = await fetch(FLAGS_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    // Read the unused body anyway: Chromium never finishes a request whose body is left unread, so the page
    // would never reach network idle.
    await response.text();
    throw new Error(`GET ${FLAGS_PATH} failed with ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isFlagValues(body)) throw new Error(`GET ${FLAGS_PATH} returned an unexpected body`);
  return body;
}
