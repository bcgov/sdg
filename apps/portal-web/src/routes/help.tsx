import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

function HelpPage() {
  return <Heading level={1}>Help</Heading>;
}
