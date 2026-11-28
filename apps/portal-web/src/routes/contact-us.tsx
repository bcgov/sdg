import { createFileRoute } from '@tanstack/react-router';

import { ContactUsPage } from '../components/contact-us-page';

export const Route = createFileRoute('/contact-us')({
  component: ContactUsPage,
});
