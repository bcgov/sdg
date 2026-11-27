import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/card')({
  component: CardPage,
});

function CardPage() {
  return <PlaceholderPage to="/dev/card" />;
}
