import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../auth/api';
import { fakeConsoleApi } from '../test-support/fake-console-api';
import { renderAt } from '../test-support/render';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('not-authorized page (R3)', () => {
  it('says the admin client role is required on the sign-in card, with sign-out and a different account', async () => {
    renderAt('/not-authorized');
    const main = await screen.findByRole('main');
    const card = within(main);
    expect(
      await card.findByRole('heading', { level: 1, name: 'You are not authorized to use SDG Console' }),
    ).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveTextContent('requires the admin client role');
    expect(main.querySelector('img[src="/favicon.svg"]')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(card.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Sign in with a different account' })).toHaveAttribute(
      'href',
      '/api/auth/login?returnTo=%2F',
    );
  });

  it("signs out through console-api's logout, which returns Keycloak's logout URL when a session exists", async () => {
    const navigate = vi.fn<(url: string) => void>();
    const realLogout = api.logout;
    const logout = vi.spyOn(api, 'logout').mockImplementation((onSignedOut) => realLogout(onSignedOut, navigate));
    const consoleApi = fakeConsoleApi({ signedIn: false });
    renderAt('/not-authorized');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(consoleApi.callsTo('POST', '/api/auth/logout')).toHaveLength(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
