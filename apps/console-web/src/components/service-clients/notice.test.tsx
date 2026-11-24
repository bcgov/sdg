import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as http from '../../api/http';
import { ApiError } from '../../api/http';
import { failureNotice, loadFailureNotice, NoticeAlert, type Notice } from './notice';

const makeNotice = (overrides: Partial<Notice>): Notice => ({
  variant: 'danger',
  title: 'Title',
  description: 'desc',
  ...overrides,
});

describe('notice', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Should map every ApiErrorKind in failureNotice (lines 24, 46-57)', () => {
    const retry = vi.fn<() => void>();

    expect(failureNotice(new ApiError('session-ended', 401), 'billing-1', retry)).toBeNull();
    expect(failureNotice(new ApiError('not-authorized', 403), 'billing-1', retry)).toBeNull();

    expect(failureNotice(new ApiError('unavailable', 503), 'billing-1', retry)).toMatchObject({
      variant: 'danger',
      title: 'The service is temporarily unavailable',
      retry,
    });
    expect(failureNotice(new ApiError('blocked', 403), 'billing-1', retry)).toMatchObject({
      variant: 'danger',
      title: 'The request was blocked',
      reload: true,
    });
    expect(failureNotice(new ApiError('not-found', 404), 'billing-1', retry)).toMatchObject({
      variant: 'warning',
      title: 'billing-1 was already removed by another administrator',
    });
    expect(failureNotice(new ApiError('invalid', 400, ['bad id', 'too short']), 'billing-1', retry)).toEqual({
      variant: 'danger',
      title: 'billing-1 could not be changed',
      description: 'bad id too short',
    });

    vi.spyOn(http, 'apiErrorKind').mockReturnValueOnce('invalid');
    expect(failureNotice(new Error('plain'), 'billing-1', retry)).toEqual({
      variant: 'danger',
      title: 'billing-1 could not be changed',
      description: '',
    });

    expect(failureNotice(new ApiError('unexpected', 500), 'billing-1', retry)).toMatchObject({
      variant: 'danger',
      title: 'Something went wrong',
      reload: true,
    });
  });

  it('Should map every ApiErrorKind in loadFailureNotice', () => {
    const retry = vi.fn<() => void>();

    expect(loadFailureNotice(new ApiError('session-ended', 401), 'Registry', retry)).toBeNull();
    expect(loadFailureNotice(new ApiError('not-authorized', 403), 'Registry', retry)).toBeNull();
    expect(loadFailureNotice(new ApiError('blocked', 403), 'Registry', retry)).toMatchObject({
      title: 'The request was blocked',
      reload: true,
    });
    expect(loadFailureNotice(new ApiError('unavailable', 503), 'Registry', retry)).toMatchObject({
      title: 'The service is temporarily unavailable',
      retry,
    });
    expect(loadFailureNotice(new ApiError('unexpected', 500), 'Registry', retry)).toMatchObject({
      title: 'Something went wrong',
      retry,
    });
  });

  it('Should render retry, reload, or no action button in NoticeAlert', async () => {
    const user = userEvent.setup();
    const retry = vi.fn<() => void>();
    const onDismiss = vi.fn<() => void>();

    const retryNotice = makeNotice({ title: 'Retry with dismiss', retry });
    const retryAloneNotice = makeNotice({ title: 'Retry alone', retry });
    const reloadNotice = makeNotice({ title: 'Reload', reload: true });
    const infoNotice = makeNotice({ variant: 'warning', title: 'Info' });

    const { rerender } = render(<NoticeAlert notice={retryNotice} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(<NoticeAlert notice={retryAloneNotice} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(2);

    const reload = vi.fn<() => void>();
    vi.stubGlobal('location', { reload });
    rerender(<NoticeAlert notice={reloadNotice} />);
    await user.click(screen.getByRole('button', { name: 'Reload the page' }));
    expect(reload).toHaveBeenCalledTimes(1);

    rerender(<NoticeAlert notice={infoNotice} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
