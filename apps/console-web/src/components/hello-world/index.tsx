import { Text } from '@repo/design-system/components/text';
import { useFlag } from '@repo/feature-flags';
import { useQuery } from '@tanstack/react-query';

import { apiErrorKind, apiRequest } from '../../api/http';

export const HELLO_WORLD_PATH = '/api/v1/shared/hello-world';
export const helloWorldQueryKey = ['shared', 'hello-world'] as const;

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;
  return typeof body.message === 'string' ? body.message : null;
}

/**
 * Resolves the message, or null when there is none to show. Every failure resolves null rather than rejecting, so the
 * query never errors: an `ApiError` in the query cache would set off the app's refusal redirects (a 401 to the
 * sign-in card, core-api's 403 to not-authorized), and this demo must never move the administrator. A 404 means
 * `hello_world` is off for them; anything else is logged.
 */
async function fetchHelloWorld(): Promise<string | null> {
  try {
    const message = messageOf(await apiRequest(HELLO_WORLD_PATH));
    if (message === null) console.warn(`GET ${HELLO_WORLD_PATH} returned an unexpected body`);
    return message;
  } catch (error) {
    if (apiErrorKind(error) !== 'not-found') console.warn(`GET ${HELLO_WORLD_PATH} failed`, error);
    return null;
  }
}

/** The `hello_world` demo (R13): asks core-api only once the flag is on, and renders nothing until it answers. */
export function HelloWorld() {
  const { isEnabled } = useFlag('hello_world');
  const { data } = useQuery({
    queryKey: helloWorldQueryKey,
    queryFn: fetchHelloWorld,
    enabled: isEnabled,
    retry: false,
    staleTime: Infinity,
  });
  if (!isEnabled || !data) return null;
  return <Text elementType="p">{data}</Text>;
}
