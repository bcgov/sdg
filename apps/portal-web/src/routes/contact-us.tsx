import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/contact-us')({
  component: ContactUsPage,
});

function ContactUsPage() {
  return <Heading level={1}>Contact us</Heading>;
}
