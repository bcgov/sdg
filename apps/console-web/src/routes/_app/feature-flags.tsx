import { createFileRoute, Outlet, useChildMatches } from '@tanstack/react-router';

import { FLAG_KEY_PATTERN } from '../../api/feature-flags';
import { FeatureFlagsPage } from '../../components/feature-flags/feature-flags-page';

interface FeatureFlagsSearch {
  /** The flag just deleted from its own page, which the list confirms. */
  deleted?: string;
}

export const Route = createFileRoute('/_app/feature-flags')({
  staticData: { title: 'Feature flags' },
  validateSearch: (search: Record<string, unknown>): FeatureFlagsSearch => {
    const { deleted } = search;
    return typeof deleted === 'string' && FLAG_KEY_PATTERN.test(deleted) ? { deleted } : {};
  },
  component: FeatureFlagsRoute,
});

/** The landing page, or a flag's own page (the `$key` child) in its place. */
function FeatureFlagsRoute() {
  const hasChild = useChildMatches({ select: (matches) => matches.length > 0 });
  const { deleted } = Route.useSearch();
  return hasChild ? <Outlet /> : <FeatureFlagsPage deletedKey={deleted} />;
}
