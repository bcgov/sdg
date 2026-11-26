import { createFileRoute } from '@tanstack/react-router';

import { PageLayout } from '../components/page-layout';

export const Route = createFileRoute('/contact-us')({
  component: ContactUsPage,
});

function ContactUsPage() {
  return <PageLayout title="Contact us" />;
}
