import { createFileRoute } from '@tanstack/react-router';

import { PlaceholderPage } from '../../components/dev/placeholder-page';

export const Route = createFileRoute('/dev/data-table')({
  component: DataTablePage,
});

function DataTablePage() {
  return <PlaceholderPage to="/dev/data-table" />;
}
