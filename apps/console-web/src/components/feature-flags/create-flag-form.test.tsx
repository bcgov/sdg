import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { act, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/http';
import { nestError } from '../../test-support/fake-console-api';
import { fakeFeatureFlagsApi, flag } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';
import { flagFailureNotice, useFlagFeedback } from './use-flag-feedback';

const LIST = '/api/v1/console/feature-flags';
const noop = () => {};

/** Opens the create dialog from the landing page's button. */
async function openCreate() {
  const opener = await screen.findByRole('button', { name: 'Create feature flag' });
  await userEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Create a feature flag' });
  return { opener, dialog, form: within(dialog) };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('create a feature flag in a dialog (R15, KTD12, KTD13)', () => {
  it('opens a dialog that starts off, for the portal, at 0%', async () => {
    fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    expect(form.getByRole('textbox', { name: /Rollout percentage/ })).toHaveValue('0');
    expect(form.getByRole('radio', { name: 'Portal' })).toBeChecked();
    expect(form.getByRole('switch', { name: 'On' })).not.toBeChecked();
  });

  it('creates the flag with the rollout sent as 0, closes the dialog, adds the row and says so', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    await userEvent.type(form.getByRole('textbox', { name: /Key/ }), 'new_search');
    await userEvent.type(form.getByRole('textbox', { name: /Description/ }), '  The new search page ');
    await userEvent.click(form.getByRole('radio', { name: 'Console' }));
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    const row = (await screen.findByRole('rowheader', { name: 'new_search' })).closest('[role="row"]');
    expect(row).toHaveTextContent('new_searchConsoleOff0%0 on, 0 off');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status', { name: 'Feature flag updates' })).toHaveTextContent('Created new_search.');
    expect(api.callsTo('POST', LIST).map((call) => call.body)).toEqual([
      { key: 'new_search', description: 'The new search page', enabled: false, rolloutPct: 0, audience: 'console' },
    ]);
  }, 15000);

  it('rejects a key like Hello before calling console-api', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const { form } = await openCreate();
    const key = form.getByRole('textbox', { name: /Key/ });
    await userEvent.type(key, 'Hello');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    expect(await form.findByText(/Use 2 to 63 lower-case letters/)).toBeInTheDocument();
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', LIST)).toEqual([]);
  });

  it("shows the server's 409 for a duplicate key next to the field and keeps the dialog and input", async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags');
    await screen.findByRole('rowheader', { name: 'hello_world' });
    const { form } = await openCreate();
    const key = form.getByRole('textbox', { name: /Key/ });
    await userEvent.type(key, 'hello_world');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    expect(await form.findByText('Feature flag hello_world already exists')).toBeInTheDocument();
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(key).toHaveValue('hello_world');
    expect(api.flags).toHaveLength(1);
  });

  it('closes on Cancel and on Escape without creating, returning focus to the button', async () => {
    const api = fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    const first = await openCreate();
    await userEvent.click(first.form.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(first.opener).toHaveFocus());

    await openCreate();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.callsTo('POST', LIST)).toEqual([]);
  });

  it('shows a form notice with retry for 503 and creates when retried (line 36)', async () => {
    const api = fakeFeatureFlagsApi();
    api.refuseNext('POST', LIST, () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags');
    const { form } = await openCreate();
    await userEvent.type(form.getByRole('textbox', { name: /Key/ }), 'new_search');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    const alert = await form.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.find('new_search')).toBeDefined();
  });

  it('places prefixed 400 reasons on fields and unprefixed ones in the form notice (lines 37-45)', async () => {
    const api = fakeFeatureFlagsApi();
    api.refuseNext('POST', LIST, () => nestError(400, ['description: Too long', 'Something else went wrong']));
    renderAt('/feature-flags');
    const { form } = await openCreate();
    await userEvent.type(form.getByRole('textbox', { name: /Key/ }), 'new_search');
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));

    expect(await form.findByText('Too long')).toBeInTheDocument();
    const alert = form.getByRole('alert');
    expect(alert).toHaveTextContent('new_search was not created');
    expect(alert).toHaveTextContent('Something else went wrong');

    api.refuseNext('POST', LIST, () => nestError(400, 'description: Still too long'));
    await userEvent.click(form.getByRole('button', { name: 'Create feature flag' }));
    expect(await form.findByText('Still too long')).toBeInTheDocument();
    expect(form.queryByRole('alert')).toBeNull();
  });

  it('handles non-ApiError rejections via the unexpected failure notice (line 34)', async () => {
    vi.resetModules();
    vi.doMock('../../api/feature-flags', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../api/feature-flags')>();
      return {
        ...actual,
        createFlag: vi.fn<() => Promise<never>>().mockRejectedValueOnce(new Error('boom')),
      };
    });
    const { CreateFlagForm } = await import('./create-flag-form');
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CreateFlagForm onCreated={noop} onPendingChange={noop} onCancel={noop} />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /Key/ }), 'new_search');
    await userEvent.click(screen.getByRole('button', { name: 'Create feature flag' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The change to new_search may not have been saved.');
    vi.doUnmock('../../api/feature-flags');
    vi.resetModules();
  });
});

describe('use-flag-feedback', () => {
  it('Should map not-found, unexpected, conflict, and delegated errors in flagFailureNotice (lines 21-26)', () => {
    const retry = vi.fn<() => void>();

    expect(flagFailureNotice(new ApiError('not-found', 404), 'hello_world', retry)).toEqual({
      variant: 'warning',
      title: 'hello_world was already removed by another administrator',
      description: 'The page now shows the current feature flags.',
    });

    expect(flagFailureNotice(new ApiError('unexpected', 500), 'hello_world', retry)).toEqual({
      variant: 'danger',
      title: 'Something went wrong',
      description:
        'The change to hello_world may not have been saved. Reload the page to see the current feature flags.',
      reload: true,
    });

    expect(flagFailureNotice(new ApiError('conflict', 409), 'hello_world', retry)).toEqual({
      variant: 'danger',
      title: 'Something went wrong',
      description:
        'The change to hello_world may not have been saved. Reload the page to see the current feature flags.',
      reload: true,
    });

    expect(flagFailureNotice(new ApiError('unavailable', 503), 'hello_world', retry)).toMatchObject({
      variant: 'danger',
      title: 'The service is temporarily unavailable',
      retry,
    });
  });

  it('Should track status and notice, refresh on 404, dismiss, and reset in useFlagFeedback', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const retry = vi.fn<() => void>();
    const { result } = renderHook(() => useFlagFeedback(), { wrapper: createWrapper(queryClient) });

    act(() => result.current.confirm('Saved hello_world.'));
    expect(result.current.status).toBe('Saved hello_world.');

    act(() => result.current.fail(new ApiError('unavailable', 503), 'hello_world', retry));
    expect(result.current.notice?.title).toBe('The service is temporarily unavailable');
    expect(invalidateSpy).not.toHaveBeenCalled();

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();

    act(() => result.current.fail(new ApiError('not-found', 404), 'hello_world', retry));
    expect(result.current.notice?.variant).toBe('warning');
    expect(invalidateSpy).toHaveBeenCalled();

    act(() => result.current.reset());
    expect(result.current.status).toBe('');
    expect(result.current.notice).toBeNull();
  });
});
