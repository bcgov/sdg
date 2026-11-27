import { Outlet, createFileRoute, notFound } from '@tanstack/react-router';

// Dev-only: outside `vite dev` every /dev page is a 404, so these helpers never reach a deployed site.
export const Route = createFileRoute('/dev')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: Outlet,
});
