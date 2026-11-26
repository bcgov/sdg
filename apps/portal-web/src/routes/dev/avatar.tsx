import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/avatar')({
  component: AvatarPage,
});

function AvatarPage() {
  return <PlaceholderPage to="/dev/avatar" />;
}
