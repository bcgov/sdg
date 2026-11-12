import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/profile')({
  staticData: { title: 'Profile' },
  component: ProfilePage,
});

function ProfilePage() {
  return <Text elementType="p">There are no profile settings to change yet.</Text>;
}
