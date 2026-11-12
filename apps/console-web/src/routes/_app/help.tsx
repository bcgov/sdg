import { Text } from '@repo/design-system/components/text';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/help')({
  staticData: { title: 'Get help' },
  component: HelpPage,
});

function HelpPage() {
  return <Text elementType="p">Help for SDG Console is not written yet.</Text>;
}
