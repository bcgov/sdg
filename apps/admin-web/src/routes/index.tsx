import { Heading } from '@repo/design-system/components/heading';
import { Link as DesignSystemLink } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { loginHref } from '../auth/api';
import { type AuthErrorCode, parseAuthError } from '../auth/auth-error';
import { useCurrentUser } from '../auth/use-current-user';
import { AuthErrorNotice } from '../components/auth-error-notice';
import { Link } from '../components/link';
import { SessionEndedNotice } from '../components/session-ended-notice';

type IndexSearch = Record<string, unknown> & { authError?: AuthErrorCode; session?: 'ended'; returnTo?: string };

/** Only a same-app path; admin-api's login re-checks it (safeReturnTo) anyway. */
function parseReturnTo(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : undefined;
}

export const Route = createFileRoute('/')({
  validateSearch: (search): IndexSearch => ({
    ...search,
    authError: parseAuthError(search['authError']),
    session: search['session'] === 'ended' ? 'ended' : undefined,
    returnTo: parseReturnTo(search['returnTo']),
  }),
  component: HomePage,
});

function Welcome() {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return null;
  if (user) {
    return (
      <Text elementType="p">
        <Link to="/service-clients">Manage service accounts</Link>
      </Text>
    );
  }
  return (
    <>
      <Text elementType="p">Sign in with your IDIR to manage the service accounts allowed to call the gateway.</Text>
      <DesignSystemLink href={loginHref('/')} isButton>
        Sign in
      </DesignSystemLink>
    </>
  );
}

function HomePage() {
  const { authError, session, returnTo } = Route.useSearch();
  const navigate = useNavigate();
  const dismiss = useCallback(() => {
    void navigate({
      to: '/',
      search: (prev) => ({ ...prev, authError: undefined, session: undefined, returnTo: undefined }),
      replace: true,
    });
  }, [navigate]);
  return (
    <>
      {authError && <AuthErrorNotice code={authError} returnTo="/" onDismiss={dismiss} />}
      {session === 'ended' && <SessionEndedNotice returnTo={returnTo ?? '/service-clients'} onDismiss={dismiss} />}
      <Heading level={1}>SDG administration</Heading>
      <Welcome />
    </>
  );
}
