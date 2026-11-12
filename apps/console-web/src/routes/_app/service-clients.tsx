import { createFileRoute } from '@tanstack/react-router';

import { RegistryPage } from '../../components/service-clients/registry-page';

export const Route = createFileRoute('/_app/service-clients')({
  staticData: { title: 'Service accounts' },
  component: RegistryPage,
});
