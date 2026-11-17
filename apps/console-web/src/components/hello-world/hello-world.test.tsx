import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeConsoleApi, nestError, type FakeConsoleApi } from '../../test-support/fake-console-api';
import { renderAt } from '../../test-support/render';

const FLAGS = '/api/v1/shared/flags';
const HELLO_WORLD = '/api/v1/shared/hello-world';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Renders the dashboard and waits for its own content, so the flags request has gone out. */
async function renderDashboard(api: FakeConsoleApi) {
  const rendered = renderAt('/');
  expect(await screen.findByText('There is nothing on the dashboard yet.')).toBeInTheDocument();
  await waitFor(() => expect(api.callsTo('GET', FLAGS)).toHaveLength(1));
  return rendered;
}

/** Lets pending answers render, so a hello-world that would appear has had the chance to. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

/** The dashboard stayed put: no hello-world, no error notice and no refusal redirect. */
async function expectPlainDashboard(router: ReturnType<typeof renderAt>['router']) {
  await settle();
  expect(screen.queryByText('Hello, world!')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(router.state.location.pathname).toBe('/');
  expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
}

describe('dashboard hello-world (R13)', () => {
  it('Should show "Hello, world!" on the dashboard when hello_world is on for the console user (AE9)', async () => {
    const api = fakeConsoleApi({ flags: { hello_world: true } });
    await renderDashboard(api);
    expect(await screen.findByText('Hello, world!')).toBeInTheDocument();
    expect(api.callsTo('GET', HELLO_WORLD)).toHaveLength(1);
  });

  it('Should render without hello-world and never call it when the flag is off (R10)', async () => {
    const api = fakeConsoleApi();
    const { router } = await renderDashboard(api);
    await expectPlainDashboard(router);
    expect(api.callsTo('GET', HELLO_WORLD)).toEqual([]);
  });

  it('Should render without hello-world when the flags request fails (R7)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = fakeConsoleApi({ flags: { hello_world: true } });
    api.refuseNext('GET', FLAGS, () => nestError(503, 'Service Unavailable'));
    const { router } = await renderDashboard(api);
    await expectPlainDashboard(router);
    expect(api.callsTo('GET', HELLO_WORLD)).toEqual([]);
  });

  it.each([
    ['404', () => nestError(404, 'Not Found')],
    ['401', () => nestError(401, 'Unauthorized')],
    ["core-api's 403", () => nestError(403, 'Forbidden resource')],
    ['503', () => nestError(503, 'Service Unavailable')],
  ])(
    'Should render nothing, send one request and not redirect when hello-world answers %s',
    async (_label, respond) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const api = fakeConsoleApi({ flags: { hello_world: true } });
      api.refuseNext('GET', HELLO_WORLD, respond);
      const { router } = await renderDashboard(api);
      await waitFor(() => expect(api.callsTo('GET', HELLO_WORLD)).toHaveLength(1));
      await expectPlainDashboard(router);
      expect(api.callsTo('GET', HELLO_WORLD)).toHaveLength(1);
    },
  );
});

describe('flags are fetched only inside the signed-in shell (R8)', () => {
  it.each(['/login', '/not-authorized'])('Should make no flags request on %s', async (path) => {
    const api = fakeConsoleApi({ signedIn: false });
    renderAt(path);
    expect(await screen.findByRole('main')).toBeInTheDocument();
    await settle();
    expect(api.callsTo('GET', FLAGS)).toEqual([]);
  });
});
