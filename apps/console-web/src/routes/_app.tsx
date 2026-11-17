import { FlagProvider } from '@repo/feature-flags';
import { createFileRoute, redirect } from '@tanstack/react-router';

import { parseAuthError, parseSessionNotice } from '../auth/auth-error';
import { lookUpCurrentUser } from '../auth/use-current-user';
import { AppShell } from '../components/app-shell/app-shell';

/**
 * Every signed-in page sits under this guard (KTD4). Signed out, or when console-api can't say, the visitor goes to
 * the sign-in card, which returns them here after signing in. console-api's sign-in failure redirect
 * (`/?authError=<code>`) is forwarded with its notice; the notice is not part of where to return to. The flag
 * provider sits inside the guard, so only signed-in pages fetch flags (R8).
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    if (await lookUpCurrentUser(context.queryClient)) return;
    const search: Record<string, unknown> = location.search;
    const authError = parseAuthError(search['authError']);
    const session = parseSessionNotice(search['session']);
    const returnTo = authError || session ? location.pathname : location.href;
    throw redirect({ to: '/login', search: { authError, session, returnTo } });
  },
  component: SignedInLayout,
});

function SignedInLayout() {
  return (
    <FlagProvider>
      <AppShell />
    </FlagProvider>
  );
}
