import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderMobileShell, renderShell, tabTo } from './shell';

describe('shell test support', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Should render the desktop shell, locate its sidebar, and tab to the toggle', async () => {
    const { toggle, sidebar } = await renderShell('/');
    expect(sidebar).toBeInTheDocument();
    const user = userEvent.setup();
    await tabTo(user, toggle);
  });

  it('Should render the mobile shell with its navigation toggle', async () => {
    const { toggle, viewport } = await renderMobileShell('/');
    expect(toggle).toBeInTheDocument();
    viewport.set(false);
  });

  it('Should throw when the sidebar toggle controls no element (lines 13-14)', async () => {
    const orphanButton = document.createElement('button');
    vi.spyOn(screen, 'findByRole').mockResolvedValueOnce(orphanButton);
    await expect(renderShell('/')).rejects.toThrow('the toggle controls no element');
  });
});
