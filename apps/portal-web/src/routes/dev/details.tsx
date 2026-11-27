import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/details')({
  component: DetailsPage,
});

function DetailsPage() {
  return <PlaceholderPage to="/dev/details" />;
}
