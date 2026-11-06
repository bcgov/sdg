import type { ParsedLocation } from '@tanstack/react-router';

import type { RouterContext } from '../router';
import { assignLocation, loginHref } from './api';
import { currentUserQueryOptions } from './use-current-user';

interface BeforeLoadArgs {
  context: RouterContext;
  location: ParsedLocation;
  preload: boolean;
}

/**
 * `beforeLoad` for pages that need a signed-in user (R16): a signed-out visitor goes to sign in and comes back to the
 * page they asked for. A preload (hovering a link) never navigates, so only a real visit leaves the app.
 */
export async function requireUser({ context, location, preload }: BeforeLoadArgs): Promise<void> {
  const user = await context.queryClient.ensureQueryData(currentUserQueryOptions);
  if (user !== null || preload) return;
  assignLocation(loginHref(location.href));
  // Hold the route until the browser leaves, so the page never renders or loads anything signed out.
  await new Promise<never>(() => {});
}
