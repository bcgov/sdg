import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { type AuthErrorCode, parseAuthError } from '../auth/auth-error';
import { AuthErrorNotice } from '../components/auth-error-notice';
import { HomePage } from '../components/home-page';

type IndexSearch = Record<string, unknown> & { authError?: AuthErrorCode };

export const Route = createFileRoute('/')({
  validateSearch: (search): IndexSearch => ({ ...search, authError: parseAuthError(search['authError']) }),
  component: HomeRoute,
});

function HomeRoute() {
  const { authError } = Route.useSearch();
  const navigate = useNavigate();
  const dismiss = useCallback(() => {
    void navigate({ to: '/', search: (prev) => ({ ...prev, authError: undefined }), replace: true });
  }, [navigate]);
  return <HomePage>{authError && <AuthErrorNotice code={authError} returnTo="/" onDismiss={dismiss} />}</HomePage>;
}
