import { createFileRoute } from '@tanstack/react-router';

import { NotFound } from '../../components/not-found';

/** Any other path: signed out, the guard sends it to the sign-in card; signed in, it is "Page not found" in the shell. */
export const Route = createFileRoute('/_app/$')({
  staticData: { title: 'Page not found' },
  component: NotFound,
});
