import { createFileRoute, redirect } from '@tanstack/react-router';

import { loginHref } from '../auth/api';
import { lookUpCurrentUser } from '../auth/use-current-user';

/**
 * Pages under this pathless layout need a signed-in user. Signed out, or when portal-api can't say, the visitor goes
 * straight to the BFF login (a full-page navigation to Keycloak), which returns them to the page they asked for. It
 * replaces the history entry, so Back doesn't land on the guard again.
 */
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    if (await lookUpCurrentUser(context.queryClient)) return;
    throw redirect({ href: loginHref(location.href), reloadDocument: true, replace: true });
  },
});
