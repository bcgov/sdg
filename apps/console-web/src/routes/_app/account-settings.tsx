import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/account-settings')({
  staticData: { title: 'Account settings' },
  component: AccountSettingsPage,
});

function AccountSettingsPage() {
  return <Text elementType="p">There are no account settings to change yet.</Text>;
}
