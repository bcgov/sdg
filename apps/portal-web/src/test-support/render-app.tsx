import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from '../app';
import { createAppRouter } from '../router';
import type { InboxBackend } from './inbox-backend';

/** Renders the whole app at `path` against `backend` as portal-api. */
export function renderApp(backend: InboxBackend, path: string) {
  vi.stubGlobal('fetch', backend.fetch);
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return { queryClient, router };
}

/** The inbox list's rows, as their visible text. */
export async function findRows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Notifications' });
  return within(list).getAllByRole('listitem');
}

/** Each row's title, prefixed with `*` when the row is marked unread. */
export async function rowTitles(): Promise<string[]> {
  const rows = await findRows();
  return rows.map((row) => {
    const title = within(row).getByRole('link').textContent ?? '';
    return within(row).queryByText('Unread') ? `*${title}` : title;
  });
}
