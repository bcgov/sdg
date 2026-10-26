import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return <Heading level={1}>Welcome to SDG</Heading>;
}
