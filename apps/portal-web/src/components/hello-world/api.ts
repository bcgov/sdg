/** core-api's demo endpoint, gated by the `hello_world` flag (forwarded by portal-api even when signed out). */
export const HELLO_WORLD_PATH = '/api/v1/shared/hello-world';

interface HelloWorldBody {
  message: string;
}

function isHelloWorldBody(value: unknown): value is HelloWorldBody {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}

/** `null` on 404 (the flag is off for this caller). Any other failure throws. */
export async function fetchHelloWorld(): Promise<string | null> {
  const response = await fetch(HELLO_WORLD_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    // Read the unused body anyway: Chromium never finishes a request whose body is left unread, so the page
    // would never reach network idle.
    await response.text();
    if (response.status === 404) return null;
    throw new Error(`GET ${HELLO_WORLD_PATH} failed with ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!isHelloWorldBody(body)) throw new Error(`GET ${HELLO_WORLD_PATH} returned an unexpected body`);
  return body.message;
}
