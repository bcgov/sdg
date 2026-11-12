import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { useRefusalRedirects } from '../api/use-refusal-redirects';
import { Devtools } from '../components/devtools';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/** Each layout below owns its page chrome: the sign-in card (/login, /not-authorized) or the app shell (`_app`). */
function RootLayout() {
  useRefusalRedirects();
  return (
    <>
      <Outlet />
      <Devtools />
    </>
  );
}
