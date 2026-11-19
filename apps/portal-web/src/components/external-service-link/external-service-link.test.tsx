import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ExternalServiceLink } from '.';

function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const services = createRoute({
    getParentRoute: () => rootRoute,
    path: '/services',
    component: () => <ExternalServiceLink href="https://partner.gov.bc.ca/apply?step=1">Apply</ExternalServiceLink>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([services]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

describe('ExternalServiceLink', () => {
  it("adds this page's path, search and hash as return-to, keeping the other site's own query", async () => {
    renderAt('/services?q=licence#results');

    expect(await screen.findByRole('link', { name: 'Apply' })).toHaveAttribute(
      'href',
      'https://partner.gov.bc.ca/apply?step=1&return-to=%2Fservices%3Fq%3Dlicence%23results',
    );
  });
});
