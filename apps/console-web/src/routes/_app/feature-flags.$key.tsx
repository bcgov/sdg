import { createFileRoute } from '@tanstack/react-router';

import { FlagDetailPage } from '../../components/feature-flags/flag-detail';
import { detailParams, type StringSearch } from '../../components/feature-flags/table-search';

export const Route = createFileRoute('/_app/feature-flags/$key')({
  staticData: { title: 'Feature flag' },
  // The overrides' `o.` and the history's `h.` params beside the list's, which the parent route passes through (KTD10).
  validateSearch: (search: Record<string, unknown>): StringSearch => detailParams(search),
  component: FlagRoute,
});

function FlagRoute() {
  const { key } = Route.useParams();
  // A remount per key, so one flag's form, notices and search never carry over to another's.
  return <FlagDetailPage key={key} flagKey={key} />;
}
