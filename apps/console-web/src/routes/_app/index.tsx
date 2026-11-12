import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/')({
  staticData: { title: 'Dashboard' },
  component: DashboardPage,
});

function DashboardPage() {
  return <Text elementType="p">There is nothing on the dashboard yet.</Text>;
}
