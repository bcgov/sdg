import { createFileRoute } from '@tanstack/react-router';

import { FlagDetailPage } from '../../components/feature-flags/flag-detail';
import { historyParams, type StringSearch } from '../../components/feature-flags/table-search';

export const Route = createFileRoute('/_app/feature-flags/$key')({
  staticData: { title: 'Feature flag' },
  // The history's `h.` params beside the list's, which the parent route passes through (KTD10).
  validateSearch: (search: Record<string, unknown>): StringSearch => historyParams(search),
  component: FlagRoute,
});

function FlagRoute() {
  const { key } = Route.useParams();
  // A remount per key, so one flag's form, notices and search never carry over to another's.
  return <FlagDetailPage key={key} flagKey={key} />;
}
