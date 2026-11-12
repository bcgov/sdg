import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderAt } from '../test-support/render';
import { ApiError } from './http';

// A 401 or 403 from a registry call is covered with the registry (components/service-clients/registry-list.test.tsx).
describe('refusal redirects', () => {
  it('does not navigate again on a second 401 while already on /login', async () => {
    const { router, queryClient } = renderAt('/login?session=ended&returnTo=%2Fservice-clients');
    await screen.findByRole('alert');
    const navigate = vi.spyOn(router, 'navigate');
    await expect(
      queryClient.fetchQuery({
        queryKey: ['late-call'],
        queryFn: () => Promise.reject(new ApiError('session-ended', 401)),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(navigate).not.toHaveBeenCalled();
    expect(router.state.location.search).toEqual({ session: 'ended', returnTo: '/service-clients' });
  });
});
