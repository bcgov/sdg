import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/section')({
  component: SectionPage,
});

function SectionPage() {
  return <PlaceholderPage to="/dev/section" />;
}
