import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeAdminApi } from '../test-support/fake-admin-api';
import { headerQueries } from '../test-support/header';
import { renderAt } from '../test-support/render';

describe('landing page', () => {
  it("shows the header's Sign in link and a sign-in button when signed out", async () => {
    renderAt('/');
    const header = await headerQueries();
    expect(await header.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
    expect(screen.queryByRole('link', { name: 'Manage service accounts' })).toBeNull();
  });

  it('links to the registry when signed in', async () => {
    fakeAdminApi();
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Manage service accounts' })).toHaveAttribute(
      'href',
      '/service-clients',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  describe('session ended (R32)', () => {
    it('says the session ended and signs in again back to where the administrator was', async () => {
      renderAt('/?session=ended&returnTo=%2Fservice-clients');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Your session ended');
      expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnTo=%2Fservice-clients',
      );
    });

    it('ignores a returnTo that leaves the app', async () => {
      renderAt('/?session=ended&returnTo=%2F%2Fevil.example');
      expect(await screen.findByRole('link', { name: 'Sign in again' })).toHaveAttribute(
        'href',
        '/api/auth/login?returnTo=%2Fservice-clients',
      );
    });

    it('clears the notice from the URL when dismissed', async () => {
      const { router } = renderAt('/?session=ended&returnTo=%2Fservice-clients&tab=1');
      await userEvent.click(await screen.findByRole('button', { name: /close/i }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(router.state.location.search).toEqual({ tab: 1 });
    });
  });

  describe('sign-in errors', () => {
    it('offers a fresh login for authError=unavailable', async () => {
      renderAt('/?authError=unavailable');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Sign-in didn't complete");
      expect(alert).toHaveTextContent('temporarily unavailable');
      expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
    });

    it.each(['login_failed', 'invalid_state'])('shows a generic message with a retry for %s', async (code) => {
      renderAt(`/?authError=${code}`);
      expect(await screen.findByRole('alert')).not.toHaveTextContent('temporarily unavailable');
      expect(screen.getByRole('link', { name: 'Try again' })).toBeInTheDocument();
    });

    it('omits the retry for access_denied and ignores unknown codes', async () => {
      renderAt('/?authError=access_denied');
      expect(await screen.findByRole('alert')).toHaveTextContent("Sign-in didn't complete");
      expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull();
    });

    it('shows nothing for an unknown code', async () => {
      renderAt('/?authError=bogus');
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
