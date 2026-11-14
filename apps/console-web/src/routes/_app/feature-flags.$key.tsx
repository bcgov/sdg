import { createFileRoute } from '@tanstack/react-router';

import { FlagDetailPage } from '../../components/feature-flags/flag-detail';

export const Route = createFileRoute('/_app/feature-flags/$key')({
  staticData: { title: 'Feature flag' },
  component: FlagRoute,
});

function FlagRoute() {
  const { key } = Route.useParams();
  // A remount per key, so one flag's form, notices and search never carry over to another's.
  return <FlagDetailPage key={key} flagKey={key} />;
}
