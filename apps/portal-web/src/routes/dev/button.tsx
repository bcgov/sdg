import { createFileRoute } from '@tanstack/react-router';

import { ButtonPage } from '../../components/dev/button-page';

export const Route = createFileRoute('/dev/button')({
  component: ButtonPage,
});
