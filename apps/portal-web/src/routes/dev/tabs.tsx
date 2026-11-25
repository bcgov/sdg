import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/tabs')({
  component: TabsPage,
});

function TabsPage() {
  return <PlaceholderPage to="/dev/tabs" />;
}
