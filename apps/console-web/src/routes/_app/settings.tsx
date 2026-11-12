import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/settings')({
  staticData: { title: 'Settings' },
  component: SettingsPage,
});

function SettingsPage() {
  return <Text elementType="p">There are no settings to change yet.</Text>;
}
