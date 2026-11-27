import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/text-field')({
  component: TextFieldPage,
});

function TextFieldPage() {
  return <PlaceholderPage to="/dev/text-field" />;
}
