import { createRootRouteWithContext } from '@tanstack/react-router';

import { NotFound } from '../components/not-found';
import { RootLayout } from '../components/root-layout';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});
