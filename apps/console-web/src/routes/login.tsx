import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Link } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { loginHref } from '../auth/api';
import { type AuthErrorCode, parseAuthError, parseSessionNotice } from '../auth/auth-error';
import { parseReturnTo } from '../auth/return-to';
import { lookUpCurrentUser, useCurrentUser } from '../auth/use-current-user';
import { AuthCard } from '../components/auth-card';
import { AuthErrorNotice } from '../components/auth-error-notice';
import { SessionEndedNotice } from '../components/session-ended-notice';

interface LoginSearch {
  authError?: AuthErrorCode;
  session?: 'ended';
  /** Where signing in returns to; the Dashboard when absent. */
  returnTo?: string;
}

export const Route = createFileRoute('/login')({
  validateSearch: (search): LoginSearch => ({
    authError: parseAuthError(search['authError']),
    session: parseSessionNotice(search['session']),
    returnTo: parseReturnTo(search['returnTo']),
  }),
  beforeLoad: async ({ context, search }) => {
    // A notice is shown even to a signed-in administrator; with none to show, the card has nothing to offer them.
    if (search.authError || search.session) return;
    if (await lookUpCurrentUser(context.queryClient)) throw redirect({ href: search.returnTo ?? '/' });
  },
  component: LoginPage,
});

/** The sign-in card: sign-in failures, the session-ended notice, and a Sign in that returns to `returnTo`. */
function LoginPage() {
  const { authError, session, returnTo = '/' } = Route.useSearch();
  const { isError } = useCurrentUser();
  const navigate = useNavigate();
  const dismiss = useCallback(() => {
    void navigate({
      to: '/login',
      search: (prev) => ({ ...prev, authError: undefined, session: undefined }),
      replace: true,
    });
  }, [navigate]);
  return (
    <AuthCard title="SDG Console">
      {authError && <AuthErrorNotice code={authError} returnTo={returnTo} onDismiss={dismiss} />}
      {session === 'ended' && <SessionEndedNotice returnTo={returnTo} onDismiss={dismiss} />}
      {isError && (
        <InlineAlert variant="warning" description="Your session could not be checked. Sign in to continue." />
      )}
      <Text elementType="p">Sign in with your IDIR to manage SDG.</Text>
      <Link href={loginHref(returnTo)} isButton>
        Sign in
      </Link>
    </AuthCard>
  );
}
