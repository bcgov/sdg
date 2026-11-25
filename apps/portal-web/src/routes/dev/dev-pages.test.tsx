import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { DEV_PAGES } from '../../components/dev/dev-pages';
import { createAppRouter } from '../../router';

vi.mock('../../components/devtools', () => ({ Devtools: () => null }));

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/dev pages', () => {
  it('lists every dev page on the index, grouped by kind', async () => {
    renderAt('/dev');
    const main = await screen.findByRole('main');

    expect(await within(main).findByRole('heading', { level: 1, name: 'Dev helpers' })).toBeInTheDocument();
    const listed = (group: string) =>
      within(within(main).getByRole('region', { name: group }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href'));
    expect(listed('Extended components')).toEqual(DEV_PAGES.filter((p) => p.kind === 'extended').map((p) => p.to));
    expect(listed('Custom components')).toEqual(DEV_PAGES.filter((p) => p.kind === 'custom').map((p) => p.to));
  });

  it.each(DEV_PAGES.map((page) => [page.to, page.title]))('renders %s with its title', async (path, title) => {
    renderAt(path);
    const main = await screen.findByRole('main');

    expect(await within(main).findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(within(main).getByRole('navigation', { name: 'On this page' })).toBeInTheDocument();
  });

  it('lists the pages alphabetically in the Dev pages menu, after the overview', async () => {
    const user = userEvent.setup();
    renderAt('/dev/button');
    await screen.findByRole('heading', { level: 1, name: 'Button' });

    await user.click(screen.getByRole('button', { name: 'Dev pages' }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);

    const titles = DEV_PAGES.map((page) => page.title).toSorted((a, b) => a.localeCompare(b));
    expect(items).toEqual(['All dev pages', ...titles]);
  });

  it('moves between pages from the Dev pages menu', async () => {
    const user = userEvent.setup();
    const router = renderAt('/dev/button');
    await screen.findByRole('heading', { level: 1, name: 'Button' });

    await user.click(screen.getByRole('button', { name: 'Dev pages' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Card' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Card' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dev/card');
  });

  it('is not found outside vite dev', async () => {
    vi.stubEnv('DEV', false);
    renderAt('/dev/button');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Button' })).not.toBeInTheDocument();
  });
});
