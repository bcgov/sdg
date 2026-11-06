import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InboxBackend, makeItem, makeItems } from '../test-support/inbox-backend';
import { findRows, renderApp, rowTitles } from '../test-support/render-app';

vi.mock('../components/devtools', () => ({ Devtools: () => null }));

const LIST = 'GET /api/v1/notifications/inbox?';

const tab = (name: RegExp) => screen.getByRole('link', { name });

describe('inbox page', () => {
  it('lists 20 items, and "Load more" appends the next page until there are no more', async () => {
    const backend = new InboxBackend(makeItems(25));
    renderApp(backend, '/inbox');
    expect(await findRows()).toHaveLength(20);
    expect(within((await findRows())[0]!).getByRole('link', { name: 'Notification 1' })).toHaveAttribute(
      'href',
      '/inbox/n-1',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(async () => expect(await findRows()).toHaveLength(25));
    expect(backend.callsTo(`${LIST}limit=20&cursor=20`)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Notification 21' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('lists unread items on ?tab=unread, with the count on the tab', async () => {
    const backend = new InboxBackend([makeItem(1), makeItem(2, { readAt: '2026-11-05T00:00:00.000Z' }), makeItem(3)]);
    renderApp(backend, '/inbox?tab=unread');
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 3']);
    const [firstLoad] = backend.callsTo(`${LIST}limit=20&unread=true`);
    expect(firstLoad?.headers['sdg-background']).toBeUndefined();
    await waitFor(() => expect(tab(/^Unread/)).toHaveTextContent('Unread (2)'));
    expect(tab(/^Unread/)).toHaveAttribute('aria-current', 'page');
    expect(tab(/^All/)).not.toHaveAttribute('aria-current');
  });

  it('keeps an item marked read on the Unread tab in place until the tab is left (AE3)', async () => {
    const backend = new InboxBackend(makeItems(3));
    renderApp(backend, '/inbox?tab=unread');
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 2', '*Notification 3']);

    await userEvent.click(screen.getByRole('button', { name: 'Mark read: Notification 2' }));

    await waitFor(() => expect(tab(/^Unread/)).toHaveTextContent('Unread (2)'));
    expect(await rowTitles()).toEqual(['*Notification 1', 'Notification 2', '*Notification 3']);
    expect(backend.callsTo('POST /api/v1/notifications/inbox/i-2/read')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Notification 3' })).toHaveFocus();

    await userEvent.click(tab(/^All/));
    expect(await rowTitles()).toEqual(['*Notification 1', 'Notification 2', '*Notification 3']);
    await userEvent.click(tab(/^Unread/));
    await waitFor(async () => expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 3']));
  });

  it('keeps an item read elsewhere in place when a change signal refetches the Unread tab (AE3)', async () => {
    const backend = new InboxBackend(makeItems(3));
    renderApp(backend, '/inbox?tab=unread');
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 2', '*Notification 3']);
    const listLoads = backend.callsTo(LIST).length;

    backend.readElsewhere('i-2');
    backend.signal();

    await waitFor(() => expect(backend.callsTo(LIST).length).toBeGreaterThan(listLoads + 1));
    await waitFor(async () =>
      expect(await rowTitles()).toEqual(['*Notification 1', 'Notification 2', '*Notification 3']),
    );
    await waitFor(() => expect(tab(/^Unread/)).toHaveTextContent('Unread (2)'));
  });

  it('puts a new arrival at the top after a refetch, with no duplicate rows across pages', async () => {
    const backend = new InboxBackend(makeItems(30, 2));
    renderApp(backend, '/inbox');
    await findRows();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(async () => expect(await findRows()).toHaveLength(30));

    backend.items = [makeItem(1), ...backend.items];
    backend.signal();

    await waitFor(async () => expect((await rowTitles())[0]).toBe('*Notification 1'));
    const titles = await rowTitles();
    expect(titles).toHaveLength(31);
    expect(new Set(titles).size).toBe(31);
    // "Load more" is a user action; refetches are not, so they do not extend the sign-in (KTD8).
    const secondPage = backend.callsTo(`${LIST}limit=20&cursor=20`);
    expect(secondPage.length).toBeGreaterThan(1);
    expect(secondPage[0]?.headers['sdg-background']).toBeUndefined();
    expect(secondPage.at(-1)?.headers['sdg-background']).toBe('1');
  });

  it('"Mark all as read" posts once and the refetched list shows every row read', async () => {
    const backend = new InboxBackend(makeItems(3));
    renderApp(backend, '/inbox');
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 2', '*Notification 3']);

    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(async () =>
      expect(await rowTitles()).toEqual(['Notification 1', 'Notification 2', 'Notification 3']),
    );
    expect(backend.callsTo('POST /api/v1/notifications/inbox/read-all')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled());
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toHaveFocus();
  });

  it('keeps the loaded rows and offers a retry below them when "Load more" fails', async () => {
    const backend = new InboxBackend(makeItems(25));
    renderApp(backend, '/inbox');
    await findRows();
    backend.failures.set(`${LIST}limit=20&cursor=20`, 502);

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    const alert = await screen.findByText('We could not load more notifications.');
    expect(await findRows()).toHaveLength(20);
    const list = screen.getByRole('list', { name: 'Notifications' });
    expect(list.compareDocumentPosition(alert)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    backend.failures.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(async () => expect(await findRows()).toHaveLength(25));
  });

  it('leaves the rows as they were and shows an alert when marking read fails', async () => {
    const backend = new InboxBackend(makeItems(2));
    renderApp(backend, '/inbox');
    await findRows();
    backend.failures.set('POST', 503);

    await userEvent.click(screen.getByRole('button', { name: 'Mark read: Notification 1' }));
    expect(await screen.findByText('We could not mark the notification as read.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByText('We could not mark all notifications as read.')).toBeInTheDocument();
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 2']);
  });

  it('shows each tab its own empty state', async () => {
    const backend = new InboxBackend([]);
    renderApp(backend, '/inbox');
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
    backend.items = [makeItem(1, { readAt: '2026-11-05T00:00:00.000Z' })];
    await userEvent.click(tab(/^Unread/));
    expect(await screen.findByText('You have no unread notifications.')).toBeInTheDocument();
  });

  it('shows an error with a retry when the list cannot load', async () => {
    const backend = new InboxBackend(makeItems(2));
    backend.failures.set(LIST, 502);
    renderApp(backend, '/inbox');
    expect(await screen.findByText('We could not load your notifications.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument();

    backend.failures.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowTitles()).toEqual(['*Notification 1', '*Notification 2']);
  });
});
