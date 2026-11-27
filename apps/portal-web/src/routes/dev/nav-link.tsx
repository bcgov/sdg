import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/nav-link')({
  component: NavLinkPage,
});

function NavLinkPage() {
  return <PlaceholderPage to="/dev/nav-link" />;
}
