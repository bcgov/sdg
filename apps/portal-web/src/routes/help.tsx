import { createFileRoute } from '@tanstack/react-router';

import { PageLayout } from '../components/page-layout';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

function HelpPage() {
  return <PageLayout title="Help" />;
}
