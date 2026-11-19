import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/services')({
  component: ServicesPage,
});

function ServicesPage() {
  return <Heading level={1}>Services</Heading>;
}
