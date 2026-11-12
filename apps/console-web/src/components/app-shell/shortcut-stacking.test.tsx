import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { fakeConsoleApi, serviceClient } from '../../test-support/fake-console-api';
import { renderShell } from '../../test-support/shell';

// The palette and the panel come from console-web's own react-aria copy; the design system's dialogs and menus come
// from the copy bcgov bundles. Their focus containment and hide-outside fight when one opens over the other, so the
// shell's shortcuts do nothing while a page's dialog or menu is open (KTD7).
describe('shortcuts while a design-system dialog or menu is open', () => {
  it('does not open the palette or toggle the sidebar over the Remove dialog', async () => {
    const user = userEvent.setup();
    const { sidebar } = await renderShell(
      '/service-clients',
      fakeConsoleApi({ clients: [serviceClient('billing-1')] }),
    );
    await user.click(await screen.findByRole('button', { name: 'Remove billing-1' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove billing-1?' });

    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Control>}b{/Control}');

    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();
    expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(dialog).toBeInTheDocument();
  });

  it('does not open the palette over the open account menu', async () => {
    const user = userEvent.setup();
    await renderShell('/');
    await user.click(screen.getByRole('button', { name: /^Account menu for / }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument();
  });
});
