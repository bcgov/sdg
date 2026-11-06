import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../auth/api';
import { InboxBackend, makeItem, makeItems } from '../test-support/inbox-backend';
import { renderApp } from '../test-support/render-app';

vi.mock('../components/devtools', () => ({ Devtools: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
});

const BY_NOTIFICATION = 'GET /api/v1/notifications/inbox/by-notification/';
const READ = 'POST /api/v1/notifications/inbox/';
const READ_AT = '2026-11-05T00:00:00.000Z';

const findTitle = (name: string) => screen.findByRole('heading', { level: 1, name });

describe('notification page', () => {
  it('shows the notification and posts exactly one read; reopening it posts none (AE6)', async () => {
    const backend = new InboxBackend(makeItems(2));
    const { router } = renderApp(backend, '/inbox/n-1');

    expect(await findTitle('Notification 1')).toBeInTheDocument();
    expect(screen.getByText('Body 1')).toBeInTheDocument();
    expect(screen.getByText(/2026/u, { selector: 'time' })).toHaveAttribute('datetime', makeItem(1).createdAt);
    await waitFor(() => expect(backend.callsTo(READ)).toHaveLength(1));
    // The read takes the item id, not the notification id.
    expect(backend.callsTo(`${READ}i-1/read`)).toHaveLength(1);
    // The refetch after the read is background traffic and sees the item read, so it posts nothing more.
    await waitFor(() => expect(backend.callsTo(BY_NOTIFICATION).at(-1)?.headers['sdg-background']).toBe('1'));

    await router.navigate({ to: '/inbox' });
    await screen.findByRole('heading', { level: 1, name: 'Inbox' });
    await router.navigate({ to: '/inbox/$notificationId', params: { notificationId: 'n-1' } });
    expect(await findTitle('Notification 1')).toBeInTheDocument();
    expect(backend.callsTo(READ)).toHaveLength(1);
  });

  it('posts no read for an item that is already read', async () => {
    const backend = new InboxBackend([makeItem(1, { readAt: READ_AT })]);
    renderApp(backend, '/inbox/n-1');
    expect(await findTitle('Notification 1')).toBeInTheDocument();
    expect(backend.callsTo(READ)).toEqual([]);
  });

  it('shows "Page not found" and posts nothing when the item is missing or not yours (AE4)', async () => {
    const backend = new InboxBackend(makeItems(1));
    renderApp(backend, '/inbox/someone-elses');
    expect(await findTitle('Page not found')).toBeInTheDocument();
    expect(backend.callsTo(`${BY_NOTIFICATION}someone-elses`)).toHaveLength(1);
    expect(backend.callsTo(READ)).toEqual([]);
  });

  it('sends a signed-out visitor to sign in, returning to the page (AE9)', async () => {
    const assign = vi.spyOn(api, 'assignLocation').mockImplementation(() => {});
    const backend = new InboxBackend(makeItems(2));
    backend.signedIn = false;
    renderApp(backend, '/inbox/n-2');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Finbox%2Fn-2'));
    expect(backend.callsTo('GET /api/v1/notifications')).toEqual([]);
  });

  it('fetches the item on preload (hovering a link) but posts no read', async () => {
    const backend = new InboxBackend(makeItems(1));
    const { router } = renderApp(backend, '/');
    await screen.findByRole('heading', { name: 'Welcome to SDG' });

    await router.preloadRoute({ to: '/inbox/$notificationId', params: { notificationId: 'n-1' } });

    expect(backend.callsTo(`${BY_NOTIFICATION}n-1`)).toHaveLength(1);
    expect(backend.callsTo(READ)).toEqual([]);
    expect(router.state.location.pathname).toBe('/');
  });

  it('opens from an inbox row without leaving the app', async () => {
    const backend = new InboxBackend(makeItems(2));
    renderApp(backend, '/inbox');
    await userEvent.click(await screen.findByRole('link', { name: 'Notification 2' }));
    expect(await findTitle('Notification 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to inbox' })).toHaveAttribute('href', '/inbox');
  });

  it('shows the action URL as a button link, and no button without one', async () => {
    const backend = new InboxBackend([makeItem(1, { actionUrl: 'https://example.com/apply' }), makeItem(2)]);
    const { router } = renderApp(backend, '/inbox/n-1');
    await findTitle('Notification 1');
    expect(screen.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', 'https://example.com/apply');

    await router.navigate({ to: '/inbox/$notificationId', params: { notificationId: 'n-2' } });
    await findTitle('Notification 2');
    expect(screen.queryByRole('link', { name: 'Open link' })).not.toBeInTheDocument();
  });

  it('shows "Notification" for a null title', async () => {
    renderApp(new InboxBackend([makeItem(1, { title: null, body: null })]), '/inbox/n-1');
    expect(await findTitle('Notification')).toBeInTheDocument();
  });

  it('shows an error with a retry, not "Page not found", when the item cannot load', async () => {
    const backend = new InboxBackend(makeItems(1));
    backend.failures.set(BY_NOTIFICATION, 500);
    renderApp(backend, '/inbox/n-1');

    expect(await screen.findByText('We could not load this notification.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to inbox' })).toHaveAttribute('href', '/inbox');

    backend.failures.clear();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await findTitle('Notification 1')).toBeInTheDocument();
  });

  it('shows "Your session ended" when the item request answers 401', async () => {
    const backend = new InboxBackend(makeItems(1));
    backend.failures.set(BY_NOTIFICATION, 401);
    renderApp(backend, '/inbox/n-1');
    expect(await screen.findByText('Your session ended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2Finbox%2Fn-1',
    );
  });
});
