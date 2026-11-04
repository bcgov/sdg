import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { createAppRouter } from './router';

vi.mock('./components/devtools', () => ({ Devtools: () => null }));

const CONFIRM_URL = '/api/v1/contact-points/confirm';
const fetchMock = vi.fn<typeof fetch>();

/** portal-api as the page sees it: signed out, and the confirm route answering with `confirmStatus`. */
function portalApi(confirmStatus: number): void {
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      input === CONFIRM_URL
        ? new Response(confirmStatus === 204 ? null : JSON.stringify({ statusCode: confirmStatus }), {
            status: confirmStatus,
          })
        : Response.json({ statusCode: 401 }, { status: 401 }),
    ),
  );
}

function renderAt(path: string): void {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
}

function confirmCalls(): RequestInit[] {
  return fetchMock.mock.calls.filter(([input]) => input === CONFIRM_URL).map(([, init]) => init ?? {});
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('confirm-email page', () => {
  it('posts nothing until the button is pressed, then posts the link token and shows success', async () => {
    portalApi(204);
    renderAt('/confirm-email?token=link-token-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Confirm your email address' })).toBeInTheDocument();
    expect(confirmCalls()).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm email address' }));

    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(confirmCalls()).toEqual([
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        body: JSON.stringify({ token: 'link-token-1' }),
      }),
    ]);
    expect(screen.queryByRole('button', { name: 'Confirm email address' })).not.toBeInTheDocument();
  });

  it('shows an error for an invalid or expired token', async () => {
    portalApi(400);
    renderAt('/confirm-email?token=expired-token');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm email address' }));
    expect(await screen.findByText('This confirmation link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.queryByText('Your email address is confirmed.')).not.toBeInTheDocument();
  });

  it('keeps the button for another try when portal-api is unavailable', async () => {
    portalApi(502);
    renderAt('/confirm-email?token=link-token-2');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm email address' }));
    expect(await screen.findByText('We could not confirm your email address right now.')).toBeInTheDocument();
    expect(screen.queryByText('This confirmation link is invalid or has expired.')).not.toBeInTheDocument();
    portalApi(204);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm email address' }));
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(confirmCalls()).toHaveLength(2);
  });

  it('shows the invalid-link error without a button when the link has no token', async () => {
    portalApi(204);
    renderAt('/confirm-email');
    expect(await screen.findByText('This confirmation link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm email address' })).not.toBeInTheDocument();
    expect(confirmCalls()).toEqual([]);
  });
});
