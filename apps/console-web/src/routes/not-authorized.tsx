import { Button } from '@repo/design-system/components/button';
import { ButtonGroup } from '@repo/design-system/components/button-group';
import { Heading } from '@repo/design-system/components/heading';
import { Link } from '@repo/design-system/components/link';
import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

import { loginHref } from '../auth/api';
import { useSignOut } from '../components/site-header/use-header-auth';

export const Route = createFileRoute('/not-authorized')({
  component: NotAuthorizedPage,
});

/**
 * Where console-api sends a sign-in core-api refused, and where console-web goes when core-api refuses a call.
 * console-api has already ended the refused Keycloak session over the back channel and kept no session, so
 * Sign out goes through console-api's logout: with a session it returns Keycloak's end-session URL, without one the
 * landing page.
 */
function NotAuthorizedPage() {
  const signOut = useSignOut();
  return (
    <>
      <Heading level={1}>You are not authorized to use SDG Console</Heading>
      <Text elementType="p">
        Signing in to SDG Console requires the admin client role on the SDG console client. Your account does not have
        it, so you have not been signed in.
      </Text>
      <Text elementType="p">
        Ask your team&apos;s administrator to grant the role, or sign in with an account that has it.
      </Text>
      <ButtonGroup>
        <Button variant="primary" onPress={signOut}>
          Sign out
        </Button>
        <Link href={loginHref('/')} isButton buttonVariant="secondary">
          Sign in with a different account
        </Link>
      </ButtonGroup>
    </>
  );
}
