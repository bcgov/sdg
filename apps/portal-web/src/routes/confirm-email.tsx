import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';
import { InlineAlert } from '@repo/design-system/components/inline-alert';
import { Text } from '@repo/design-system/components/text';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

/** portal-api's public confirm route, which forwards to notification-api (R56). */
const CONFIRM_PATH = '/api/v1/contact-points/confirm';

type ConfirmOutcome = 'confirmed' | 'rejected';

interface ConfirmEmailSearch {
  token?: string;
}

/**
 * Confirms the link token. A 400 means notification-api rejected it (invalid, used or expired); any other failure
 * throws, so the page can offer another try.
 */
async function confirmEmail(token: string): Promise<ConfirmOutcome> {
  const response = await fetch(CONFIRM_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token }),
  });
  // Read the body even when unused: Chromium never finishes a request whose body is left unread.
  await response.text();
  if (response.ok) return 'confirmed';
  if (response.status === 400) return 'rejected';
  throw new Error(`POST ${CONFIRM_PATH} failed with ${response.status}`);
}

/**
 * The page the confirmation email links to (R35). It works signed out, and confirms only when the button is pressed,
 * so a mail scanner opening the link confirms nothing (KTD15).
 */
export const Route = createFileRoute('/confirm-email')({
  validateSearch: (search: Record<string, unknown>): ConfirmEmailSearch =>
    typeof search['token'] === 'string' && search['token'] !== '' ? { token: search['token'] } : {},
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const { token } = Route.useSearch();
  return (
    <>
      <Heading level={1}>Confirm your email address</Heading>
      {token === undefined ? <InvalidLink /> : <ConfirmForm token={token} />}
    </>
  );
}

function InvalidLink() {
  return (
    <InlineAlert
      variant="danger"
      title="This confirmation link is invalid or has expired."
      description="Request a new confirmation email and use the link in it."
    />
  );
}

function ConfirmForm({ token }: Readonly<{ token: string }>) {
  const { mutate, data, isError, isPending } = useMutation({
    mutationFn: confirmEmail,
    onError: (error) => console.error('portal-web: email confirmation failed', error),
  });
  const onPress = useCallback(() => mutate(token), [mutate, token]);

  if (data === 'confirmed') return <InlineAlert variant="success" title="Your email address is confirmed." />;
  if (data === 'rejected') return <InvalidLink />;
  return (
    <>
      <Text elementType="p">Press the button to confirm that this email address is yours.</Text>
      {isError ? <InlineAlert variant="warning" title="We could not confirm your email address right now." /> : null}
      <Button isPending={isPending} onPress={onPress}>
        Confirm email address
      </Button>
    </>
  );
}
