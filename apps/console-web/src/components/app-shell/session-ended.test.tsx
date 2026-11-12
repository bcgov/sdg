import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { currentUserQueryKey } from '../../auth/use-current-user';
import { renderShell } from '../../test-support/shell';

// A page with no API calls never sees a 401 of its own: the session's end shows up only as the current user going
// null when /api/auth/me is refetched (on window focus once it is stale). Review finding #1.
describe('a session that ends on a signed-in page', () => {
  it('sends the administrator to the sign-in card with the session-ended notice, returning to the page', async () => {
    const { queryClient, router } = await renderShell('/settings');

    await act(async () => {
      queryClient.setQueryData(currentUserQueryKey, null);
    });

    expect(await screen.findByRole('link', { name: 'Sign in again' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toMatchObject({ session: 'ended', returnTo: '/settings' });
  });
});
