import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';

interface ServicesSearch {
  q?: string;
}

/**
 * The router's default search parser turns `?q=2024` into a number and `?q=true` into a boolean,
 * so those come back as strings. Blank or other values mean no query.
 */
function parseQuery(value: unknown): string | undefined {
  const text = typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

export const Route = createFileRoute('/services')({
  // `q` is always returned, even as undefined, so a blank raw `?q=` can't show through the merged search.
  validateSearch: (search): ServicesSearch => ({ q: parseQuery(search['q']) }),
  component: ServicesPage,
});

function ServicesPage() {
  return <Heading level={1}>Services</Heading>;
}
