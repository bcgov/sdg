import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { type AuthErrorCode, parseAuthError } from '../auth/auth-error';
import { AuthErrorNotice } from '../components/auth-error-notice';

type IndexSearch = Record<string, unknown> & { authError?: AuthErrorCode };

export const Route = createFileRoute('/')({
  validateSearch: (search): IndexSearch => ({ ...search, authError: parseAuthError(search['authError']) }),
  component: HomePage,
});

function HomePage() {
  const { authError } = Route.useSearch();
  const navigate = useNavigate();
  const dismiss = useCallback(() => {
    void navigate({ to: '/', search: (prev) => ({ ...prev, authError: undefined }), replace: true });
  }, [navigate]);
  return (
    <>
      {authError && <AuthErrorNotice code={authError} returnTo="/" onDismiss={dismiss} />}
      <Heading level={1}>Welcome to SDG</Heading>
    </>
  );
}
