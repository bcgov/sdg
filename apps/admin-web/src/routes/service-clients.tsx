import { Heading } from '@repo/design-system/components/heading';
import { Link } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

import { loginHref } from '../auth/api';
import { useCurrentUser } from '../auth/use-current-user';
import { RegistryPage } from '../components/service-clients/registry-page';

export const Route = createFileRoute('/service-clients')({
  component: ServiceClientsPage,
});

/** The registry for a signed-in administrator; signed out, a way to sign in that comes back here. */
function ServiceClientsPage() {
  const { data: user, isPending, isError } = useCurrentUser();
  if (isPending) return null;
  if (user) return <RegistryPage />;
  return (
    <>
      <Heading level={1}>Service accounts</Heading>
      <Text elementType="p">
        {isError
          ? 'Your session could not be checked. Sign in to manage service accounts.'
          : 'Sign in with your IDIR to manage service accounts.'}
      </Text>
      <Link href={loginHref('/service-clients')} isButton>
        Sign in
      </Link>
    </>
  );
}
