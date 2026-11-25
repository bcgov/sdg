import { createFileRoute } from '@tanstack/react-router';

import { PageLayout } from '../components/page-layout';

interface ServicesSearch {
  q?: string;
}

/** The router keeps search values as strings; a blank query means none. */
function parseQuery(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

export const Route = createFileRoute('/services')({
  // `q` is always returned, even as undefined, so a blank raw `?q=` can't show through the merged search.
  validateSearch: (search): ServicesSearch => ({ q: parseQuery(search['q']) }),
  component: ServicesPage,
});

function ServicesPage() {
  return <PageLayout title="Services" />;
}
