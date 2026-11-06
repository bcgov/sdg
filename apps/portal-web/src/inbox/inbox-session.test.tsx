import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../auth/api';
import { headerQueries } from '../test-support/header';
import { InboxBackend, makeItems } from '../test-support/inbox-backend';
import { findRows, renderApp } from '../test-support/render-app';

vi.mock('../components/devtools', () => ({ Devtools: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inbox sign-in', () => {
  it('sends a signed-out visitor to sign in, returning to /inbox', async () => {
    const assign = vi.spyOn(api, 'assignLocation').mockImplementation(() => {});
    const backend = new InboxBackend(makeItems(2));
    backend.signedIn = false;
    renderApp(backend, '/inbox?tab=unread');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Finbox%3Ftab%3Dunread'));
    expect(backend.callsTo('GET /api/v1/notifications')).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Inbox' })).not.toBeInTheDocument();
  });

  it('does not navigate when an /inbox link is hovered while signed out', async () => {
    const assign = vi.spyOn(api, 'assignLocation').mockImplementation(() => {});
    const backend = new InboxBackend();
    backend.signedIn = false;
    const { router } = renderApp(backend, '/');
    await screen.findByRole('heading', { name: 'Welcome to SDG' });

    // What the router does on hover with `defaultPreload: 'intent'`.
    await router.preloadRoute({ to: '/inbox' });

    expect(assign).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows "Your session ended" with a sign-in link when a refetch answers 401', async () => {
    const backend = new InboxBackend(makeItems(2));
    renderApp(backend, '/inbox');
    await findRows();

    backend.signedIn = false;
    backend.signal();

    expect(await screen.findByText('Your session ended')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2Finbox');
    expect(screen.queryByText('We could not load your notifications.')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument();
  });
});

describe('header notifications', () => {
  it('turns the bell on with the relay and the inbox page', async () => {
    renderApp(new InboxBackend(makeItems(3)), '/');
    const header = await headerQueries();
    expect(await header.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    const element = document.querySelector('sdg-header');
    expect(element).toHaveAttribute('notifications-url', '/api/v1/notifications');
    expect(element).toHaveAttribute('inbox-href', '/inbox');
  });

  it('refreshes the open inbox page when the header reports a change', async () => {
    const backend = new InboxBackend(makeItems(2));
    renderApp(backend, '/inbox');
    expect(await findRows()).toHaveLength(2);

    backend.items = makeItems(3);
    backend.signal();

    await waitFor(async () => expect(await findRows()).toHaveLength(3));
    // The user is refreshed too, as a background request, so a signal never extends the sign-in (R35).
    const userLoads = backend.callsTo('GET /api/auth/me');
    expect(userLoads[0]?.headers['sdg-background']).toBeUndefined();
    await waitFor(() => expect(backend.callsTo('GET /api/auth/me').length).toBeGreaterThan(1));
    expect(backend.callsTo('GET /api/auth/me').at(-1)?.headers['sdg-background']).toBe('1');
  });

  it('clears the signed-in user in the header when the header reports a 401', async () => {
    const backend = new InboxBackend(makeItems(1));
    renderApp(backend, '/');
    const header = await headerQueries();
    await header.findByRole('button', { name: 'Notifications, 1 unread' });

    backend.signedIn = false;
    backend.signal();

    expect(await header.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(header.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
  });
});
