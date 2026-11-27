import { createFileRoute } from '@tanstack/react-router';

import { TextFieldPage } from '../../components/dev/text-field-page';

export const Route = createFileRoute('/dev/text-field')({
  component: TextFieldPage,
});
