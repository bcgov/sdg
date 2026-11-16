import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';

import { FLAG_KEY_PATTERN } from '../../api/feature-flags';
import { FeatureFlagsPage } from '../../components/feature-flags/feature-flags-page';
import { listParams, type StringSearch } from '../../components/feature-flags/table-search';

export const Route = createFileRoute('/_app/feature-flags')({
  staticData: { title: 'Feature flags' },
  // The list's search, filters, sort and page as plain strings (KTD8), and `deleted`: the flag just deleted from its
  // own page, which the list confirms. A flag's page (the `$key` child) carries the list's params too (KTD10).
  validateSearch: (search: Record<string, unknown>): StringSearch => {
    const { deleted } = search;
    const isKey = typeof deleted === 'string' && FLAG_KEY_PATTERN.test(deleted);
    return { ...listParams(search), deleted: isKey ? deleted : undefined };
  },
  component: FeatureFlagsRoute,
});

/** The landing page, or a flag's own page (the `$key` child) in its place. */
function FeatureFlagsRoute() {
  const hasChild = useChildMatches({ select: (matches) => matches.length > 0 });
  const { deleted } = Route.useSearch();
  return hasChild ? <Outlet /> : <FeatureFlagsPage deletedKey={deleted} />;
}
