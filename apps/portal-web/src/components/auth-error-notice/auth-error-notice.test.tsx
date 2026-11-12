import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../../app';
import { createAppRouter } from '../../router';

vi.mock('../devtools', () => ({ Devtools: () => null }));

function renderAt(path: string) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

describe('sign-in error notice', () => {
  it('says the service is unavailable and offers a fresh login for authError=unavailable', async () => {
    renderAt('/?authError=unavailable');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Sign-in didn't complete");
    expect(alert).toHaveTextContent('temporarily unavailable');
    const retry = screen.getByRole('link', { name: 'Try again' });
    expect(retry).toHaveAttribute('href', '/api/auth/login?returnTo=%2F');
  });

  it.each(['login_failed', 'invalid_state'])('shows a generic message with a retry for %s', async (code) => {
    renderAt(`/?authError=${code}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Sign-in didn't complete");
    expect(alert).not.toHaveTextContent('temporarily unavailable');
    expect(screen.getByRole('link', { name: 'Try again' })).toBeInTheDocument();
  });

  it('omits the retry for access_denied', async () => {
    renderAt('/?authError=access_denied');
    expect(await screen.findByRole('alert')).toHaveTextContent("Sign-in didn't complete");
    expect(screen.queryByRole('link', { name: 'Try again' })).toBeNull();
  });

  it('ignores unknown codes and shows nothing without authError', async () => {
    renderAt('/?authError=bogus');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the error from the URL when dismissed', async () => {
    const router = renderAt('/?authError=unavailable&tab=reports');
    await userEvent.click(await screen.findByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(router.state.location.search).toEqual({ tab: 'reports' });
  });
});
