import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createFlag, fetchFlag, listFlags, listHistory, searchPeople, setOverride } from '../../api/feature-flags';
import { nestError } from '../../test-support/fake-console-api';
import { fakeFeatureFlagsApi, flag, flagEvent, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';
import { rolloutError, type FlagFieldErrors, type FlagFieldValues } from './flag-fields';
import type { FlagTab } from './table-search';
import type { DetailActions } from './use-detail-actions';
import { flagAdminKeys, useCreateFlag, useDeleteFlag, useSetOverride, useUpdateFlag } from './use-feature-flags';

const HELLO = '/api/v1/console/feature-flags/hello_world';
const noop = () => {};
const DEFAULT_FIELD_VALUES: FlagFieldValues = {
  description: '',
  enabled: false,
  rolloutPct: 0,
  audience: 'portal',
};
const EMPTY_FIELD_ERRORS: FlagFieldErrors = {};
const STUB_ACTIONS: DetailActions = {
  reset: noop,
  confirm: noop,
  fail: noop,
  dismiss: noop,
  status: '',
  notice: null,
  save: noop,
  isSaving: false,
  setOverride: noop,
  isSettingOverride: false,
  removeOverride: noop,
  busyPrincipal: undefined,
  isAskingDelete: false,
  askDelete: noop,
  cancelDelete: noop,
  confirmDelete: noop,
  isDeleting: false,
};

const updates = () => screen.getByRole('status', { name: 'Feature flag updates' });
const region = (name: string) => screen.findByRole('region', { name });
const card = async (name: string) => within(await region(name));
const patches = (api: ReturnType<typeof fakeFeatureFlagsApi>) => api.callsTo('PATCH', HELLO).map((call) => call.body);

function threeOnOverrides() {
  const people = [person('Ada', 'resident'), person('Bob', 'resident'), person('Cy', 'resident')];
  return { people, overrides: people.map((who) => overrideFor(who, true)) };
}

/** Flips the overview's switch; turning it off goes through the confirmation. */
async function flip() {
  const toggle = (await card('Switch')).getByRole('switch', { name: 'On' });
  await waitFor(() => expect(toggle).toBeEnabled());
  const wasOn = toggle.matches(':checked');
  await userEvent.click(toggle);
  if (!wasOn) return;
  const dialog = await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off' }));
}

describe('a flag’s page (R16, R21)', () => {
  it('opens on its header and overview, with the notices above them', async () => {
    fakeFeatureFlagsApi({
      flags: [flag('hello_world', { description: 'The demo', enabled: true, rolloutPct: 50, overrides: [] })],
      events: [flagEvent(1, 'hello_world', 'created', { enabled: { from: null, to: true } })],
    });
    renderAt('/feature-flags/hello_world');
    const key = await screen.findByRole('heading', { level: 2, name: 'hello_world' });
    expect(screen.getByRole('heading', { level: 1, name: 'Feature flag' })).toBeInTheDocument();
    expect(screen.getByText('The demo')).toBeInTheDocument();
    expect(screen.getByText('Portal · 50% rollout · 0 forced on, 0 forced off')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect((await card('Switch')).getByRole('switch', { name: 'On' })).toBeChecked();
    expect(await region('Rollout')).toHaveTextContent('50%');
    expect(await region('Audience')).toHaveTextContent('Portal');
    expect(await region('Overrides')).toHaveTextContent('0 on · 0 off');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updates().compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says how a person gets the flag, and lists its latest changes with a way to all of them', async () => {
    const overrides = [overrideFor(person('Ada', 'resident'), true), overrideFor(person('Bob', 'resident'), false)];
    const events = Array.from({ length: 4 }, (_, index) =>
      flagEvent(index + 1, 'hello_world', 'updated', { rollout_pct: { from: index, to: index + 1 } }),
    );
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, rolloutPct: 50, overrides })], events });
    const { router } = renderAt('/feature-flags/hello_world');
    const how = await card('How a person gets hello_world');
    expect(how.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The switch is on, so overrides and then the rollout decide.',
      'Overrides come next: 1 person is forced on; 1 person is forced off.',
      'The rollout gives it to 50% of people who sign in to the portal.',
    ]);
    expect(await region('Switch')).toHaveTextContent('Off stops it for everyone, overrides included');
    const recent = await card('Recent changes');
    await waitFor(() => expect(recent.getAllByRole('row')).toHaveLength(4));
    expect(recent.getAllByRole('row')[1]).toHaveTextContent('Rollout: 3% → 4%');

    await userEvent.click(recent.getByRole('link', { name: 'All history' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'history' }));
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('says no one gets an off flag, with its overrides waiting for the switch (kill switch)', async () => {
    const overrides = [overrideFor(person('Ada', 'resident'), true)];
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false, rolloutPct: 50, overrides })] });
    renderAt('/feature-flags/hello_world');
    const how = await card('How a person gets hello_world');
    expect(how.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'The switch is off, so no one gets it, overrides included.',
      'Overrides apply once the switch is on: 1 person is forced on.',
      'The rollout of 50% counts only while the switch is on.',
    ]);
    expect(await region('Switch')).toHaveTextContent('No one gets it; overrides wait until it’s on');
  });

  it('says only that no one gets an off flag with no overrides', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false })] });
    renderAt('/feature-flags/hello_world');
    const note = await region('Switch');
    expect(note).toHaveTextContent('No one gets it');
    expect(note).not.toHaveTextContent('overrides');
  });

  it('keeps the tab in the URL, leaving it out for the overview', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    const { router } = renderAt('/feature-flags/hello_world?tab=history');
    expect(await screen.findByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    const history = await screen.findByRole('grid', { name: /^Changes to hello_world/ });
    expect(await within(history).findByText('hello_world has no history.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Overrides/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'overrides' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('edits in a dialog that sends only the rollout when only the rollout changed, then closes (KTD8)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit settings' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    const save = dialog.getByRole('button', { name: 'Save changes' });
    await userEvent.click(save);
    expect(dialog.getByText('Nothing to save: no field has changed.')).toBeInTheDocument();
    const rollout = dialog.getByRole('textbox', { name: /Rollout percentage/ });
    await userEvent.clear(rollout);
    await userEvent.type(rollout, '80');
    await userEvent.click(save);

    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patches(api)).toEqual([{ rolloutPct: 80 }]);
    expect(await region('Rollout')).toHaveTextContent('80%');
  });

  it('closes the edit dialog on Cancel without saving', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    const edit = await screen.findByRole('button', { name: 'Edit settings' });
    await userEvent.click(edit);
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    await userEvent.type(dialog.getByRole('textbox', { name: /Description/ }), 'Changed');
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(edit).toHaveFocus());
    expect(patches(api)).toEqual([]);
  });

  it('turns the flag on from the overview at once, and off only once confirmed', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false })] });
    renderAt('/feature-flags/hello_world');
    await flip();
    await waitFor(() => expect(updates()).toHaveTextContent('Saved hello_world.'));
    expect(patches(api)).toEqual([{ enabled: true }]);

    const toggle = (await card('Switch')).getByRole('switch', { name: 'On' });
    await waitFor(() => expect(toggle).toBeChecked());
    await userEvent.click(toggle);
    const dialog = await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' });
    expect(dialog).toHaveTextContent('Everyone stops getting hello_world.');
    expect(dialog).not.toHaveTextContent('override');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).toBeChecked();
    expect(patches(api)).toEqual([{ enabled: true }]);

    await flip();
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(patches(api)).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('tells whoever turns a flag off that its "on" overrides stop too, and only confirms the save (R21)', async () => {
    const { people, overrides } = threeOnOverrides();
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true, overrides })], people });
    renderAt('/feature-flags/hello_world');
    await userEvent.click((await card('Switch')).getByRole('switch', { name: 'On' }));
    expect(await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' })).toHaveTextContent(
      'Everyone stops getting hello_world, including the 3 people with an “on” override. ' +
        'Their overrides apply again when you turn it back on.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    await waitFor(() => expect(updates()).toHaveTextContent(/^Saved hello_world\.$/));
    expect(patches(api)).toEqual([{ enabled: false }]);
    expect(within(updates()).queryByRole('link')).toBeNull();
  });

  it('says another administrator already removed the flag (404 on save) and refetches into its deleted view', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { rolloutPct: 50 })] });
    renderAt('/feature-flags/hello_world');
    await card('Switch');
    api.flags = [];
    await flip();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'hello_world was already removed by another administrator',
    );
    expect(await screen.findByText('This flag was deleted. Its history is kept.')).toBeInTheDocument();
    expect(api.callsTo('GET', HELLO).length).toBeGreaterThan(1);
  });

  it('closes the switch-off dialog on Escape without turning the flag off (line 30)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true })] });
    renderAt('/feature-flags/hello_world');
    const toggle = (await card('Switch')).getByRole('switch', { name: 'On' });
    await userEvent.click(toggle);
    await screen.findByRole('alertdialog', { name: 'Turn hello_world off?' });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toggle).toBeChecked();
    expect(patches(api)).toEqual([]);
  });

  it('does not call onCancel when Modal reports onOpenChange(true) on SwitchOffDialog (line 30)', async () => {
    let capturedOnOpenChange: ((open: boolean) => void) | undefined;
    vi.resetModules();
    vi.doMock('@repo/design-system/components/modal', () => ({
      Modal: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
        capturedOnOpenChange = onOpenChange;
        return <div>{children}</div>;
      },
    }));
    const { SwitchOffDialog } = await import('./switch-off-dialog');
    const onCancel = vi.fn<() => void>();
    render(
      <SwitchOffDialog
        flag={flag('hello_world', { enabled: true })}
        isOpen={true}
        onConfirm={vi.fn<() => void>()}
        onCancel={onCancel}
      />,
    );
    capturedOnOpenChange?.(true);
    expect(onCancel).not.toHaveBeenCalled();
    vi.doUnmock('@repo/design-system/components/modal');
    vi.resetModules();
  });

  it('closes the edit dialog on Escape without saving (form-dialog line 25)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit settings' }));
    await screen.findByRole('dialog', { name: 'Edit hello_world' });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patches(api)).toEqual([]);
  });

  it('does not call onClose when Modal reports onOpenChange(true) on FormDialog (line 25)', async () => {
    let capturedOnOpenChange: ((open: boolean) => void) | undefined;
    vi.resetModules();
    vi.doMock('@repo/design-system/components/modal', () => ({
      Modal: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => {
        capturedOnOpenChange = onOpenChange;
        return <div>{children}</div>;
      },
    }));
    const { FormDialog } = await import('./form-dialog');
    const onClose = vi.fn<() => void>();
    render(
      <FormDialog title="Edit hello_world" isOpen={true} isPending={false} onClose={onClose}>
        <span>Body</span>
      </FormDialog>,
    );
    capturedOnOpenChange?.(true);
    expect(onClose).not.toHaveBeenCalled();
    vi.doUnmock('@repo/design-system/components/modal');
    vi.resetModules();
  });

  it('shows a load failure notice with retry when loading the flag fails with 503 (lines 90-91)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('GET', HELLO, () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags/hello_world');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await region('Switch')).toBeInTheDocument();
  });

  it('opens and cancels the delete confirmation dialog from the header (line 66)', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete hello_world' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete hello_world?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('renders no load failure alert in FlagBody when loading fails with 401 (line 91)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('GET', HELLO, () => nestError(401, 'Unauthorized'));
    renderAt('/feature-flags/hello_world');

    await waitFor(() => expect(api.callsTo('GET', HELLO)).toHaveLength(1));
    expect(screen.queryByText('The service is temporarily unavailable')).toBeNull();
  });

  it('ignores unknown tab keys in FlagTabs onSelectionChange (flag-tabs line 29)', async () => {
    let capturedOnSelectionChange: ((key: string | number) => void) | undefined;
    vi.resetModules();
    vi.doMock('@repo/design-system/components/tabs', () => ({
      Tabs: ({
        children,
        onSelectionChange,
      }: {
        children: ReactNode;
        onSelectionChange?: (key: string | number) => void;
      }) => {
        capturedOnSelectionChange = onSelectionChange;
        return <div>{children}</div>;
      },
      TabList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Tab: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      TabPanel: () => null,
    }));
    const { FlagTabs } = await import('./flag-tabs');
    const onShowTab = vi.fn<(tab: FlagTab) => void>();
    render(<FlagTabs flag={flag('hello_world')} actions={STUB_ACTIONS} tab="overview" onShowTab={onShowTab} />);
    capturedOnSelectionChange?.('unknown');
    expect(onShowTab).not.toHaveBeenCalled();
    vi.doUnmock('@repo/design-system/components/tabs');
    vi.resetModules();
  });

  it('describes off-only overrides and shows a fallback when recent history fails to load (flag-overview lines 121, 156)', async () => {
    const api = fakeFeatureFlagsApi({
      flags: [flag('hello_world', { overrides: [overrideFor(person('Ada', 'resident'), false)] })],
    });
    api.refuseNext('GET', '/api/v1/console/feature-flag-history', () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags/hello_world');

    const how = await screen.findByRole('region', { name: 'How a person gets hello_world' });
    expect(how).toHaveTextContent('1 person is forced off.');
    expect(await screen.findByText('The history couldn’t be loaded. Try again in a moment.')).toBeInTheDocument();
  });

  it('changes audience when a valid radio option is selected and ignores unknown values (flag-fields line 34)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { audience: 'portal' })] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit settings' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    await userEvent.click(dialog.getByRole('radio', { name: 'Console' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches(api)).toEqual([{ audience: 'console' }]));

    expect(rolloutError(50)).toEqual({});
    expect(rolloutError(Number.NaN)).toEqual({ rolloutPct: 'Enter a rollout percentage from 0 to 100' });

    let capturedOnChange: ((value: string) => void) | undefined;
    vi.resetModules();
    vi.doMock('@repo/design-system/components/radio', () => ({
      RadioGroup: ({ children, onChange }: { children: ReactNode; onChange?: (value: string) => void }) => {
        capturedOnChange = onChange;
        return <div>{children}</div>;
      },
      Radio: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    }));
    const { FlagFields } = await import('./flag-fields');
    const onChange = vi.fn<() => void>();
    render(<FlagFields values={DEFAULT_FIELD_VALUES} errors={EMPTY_FIELD_ERRORS} onChange={onChange} />);
    capturedOnChange?.('unknown');
    expect(onChange).not.toHaveBeenCalled();
    vi.doUnmock('@repo/design-system/components/radio');
    vi.resetModules();
  });

  it('toggles enabled in the edit dialog and sends only enabled (edit-flag-form lines 23-25)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false, description: null })] });
    renderAt('/feature-flags/hello_world');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit settings' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit hello_world' }));
    await userEvent.click(dialog.getByRole('switch', { name: 'On' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patches(api)).toEqual([{ enabled: true }]));
  });

  it('retries a failed override set and confirms on-flag overrides (use-detail-actions line 55)', async () => {
    const grace = person('Grace Hopper', 'resident');
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: true })], people: [grace] });
    api.refuseNext('PUT', `${HELLO}/overrides/${grace.principalId}`, () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags/hello_world?tab=overrides');

    await userEvent.click(await screen.findByRole('button', { name: 'Add or change an override' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add or change an override' }));
    await userEvent.type(dialog.getByRole('searchbox', { name: /Find a person/ }), 'grace');
    await userEvent.click(await dialog.findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Turn on for Grace Hopper' }));
    await waitFor(() => expect(api.callsTo('PUT', `${HELLO}/overrides/${grace.principalId}`)).toHaveLength(1));
    await userEvent.keyboard('{Escape}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is now on for Grace Hopper.'));
  });

  it('saves an off override on an off flag (use-detail-actions lines 47-51)', async () => {
    const grace = person('Grace Hopper', 'resident');
    fakeFeatureFlagsApi({ flags: [flag('hello_world', { enabled: false })], people: [grace] });
    renderAt('/feature-flags/hello_world?tab=overrides');

    await userEvent.click(await screen.findByRole('button', { name: 'Add or change an override' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add or change an override' }));
    await userEvent.type(dialog.getByRole('searchbox', { name: /Find a person/ }), 'grace');
    await userEvent.click(await dialog.findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Turn off for Grace Hopper' }));

    await waitFor(() =>
      expect(updates()).toHaveTextContent(
        'Saved Grace Hopper’s “off” override. It applies once hello_world is turned on.',
      ),
    );
  });

  it('retries a failed override removal (use-detail-actions lines 65-75, 79)', async () => {
    const grace = person('Grace Hopper', 'resident');
    const api = fakeFeatureFlagsApi({
      flags: [flag('hello_world', { overrides: [overrideFor(grace, true)] })],
      people: [grace],
    });
    api.refuseNext('DELETE', `${HELLO}/overrides/${grace.principalId}`, () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags/hello_world?tab=overrides');

    await userEvent.click(await screen.findByRole('button', { name: 'Remove the override for Grace Hopper' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(updates()).toHaveTextContent('Removed the override for Grace Hopper.'));
  });

  it('retries a failed flag delete and returns to the list (use-detail-actions lines 93-106)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('DELETE', HELLO, () => nestError(503, 'Service Unavailable'));
    const { router } = renderAt('/feature-flags/hello_world');

    await userEvent.click(await screen.findByRole('button', { name: 'Delete hello_world' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete hello_world?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The service is temporarily unavailable');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/feature-flags'));
  });

  it('sorts and filters existing overrides when setting a new override (use-feature-flags line 156)', async () => {
    const ada = person('Ada Lovelace', 'resident');
    const grace = person('Grace Hopper', 'resident');
    const zed = person('Zed Shaw', 'resident');
    fakeFeatureFlagsApi({
      flags: [flag('hello_world', { enabled: true, overrides: [overrideFor(ada, true), overrideFor(zed, false)] })],
      people: [ada, grace, zed],
    });
    renderAt('/feature-flags/hello_world?tab=overrides');

    await userEvent.click(await screen.findByRole('button', { name: 'Add or change an override' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add or change an override' }));
    await userEvent.type(dialog.getByRole('searchbox', { name: /Find a person/ }), 'grace');
    await userEvent.click(await dialog.findByRole('button', { name: /^Grace Hopper/ }));
    await userEvent.click(dialog.getByRole('button', { name: 'Turn on for Grace Hopper' }));

    await waitFor(() => expect(updates()).toHaveTextContent('hello_world is now on for Grace Hopper.'));
    expect(await screen.findByRole('tab', { name: /Overrides 3/ })).toBeInTheDocument();
  });

  it('shows blocked and error history table states and refreshes on Older (use-feature-flags lines 68, 70)', async () => {
    const events = Array.from({ length: 25 }, (_, index) =>
      flagEvent(index + 1, 'hello_world', 'updated', { rollout_pct: { from: index, to: index + 1 } }),
    );
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')], events });
    api.refuseNext('GET', '/api/v1/console/feature-flag-history', () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags/hello_world?tab=history');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Older' }));
    await waitFor(() => expect(api.callsTo('GET', '/api/v1/console/feature-flag-history').length).toBeGreaterThan(2));
  });

  it('reports blocked when history search is refused by the edge WAF (use-feature-flags line 68)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('GET', '/api/v1/console/feature-flag-history', () => new Response('Forbidden', { status: 403 }));
    renderAt('/feature-flags/hello_world?tab=history');
    await waitFor(() => expect(api.callsTo('GET', '/api/v1/console/feature-flag-history')).toHaveLength(1));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('covers mutation cache fallbacks when detail or list pages are absent or omit the flag (use-feature-flags lines 94-97, 107, 121-123, 133)', async () => {
    const ada = person('Ada', 'resident');
    fakeFeatureFlagsApi({ flags: [flag('hello_world'), flag('other_flag')], people: [ada] });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(flagAdminKeys.listPage({ limit: 20, offset: 0 }), {
      items: [flag('hello_world')],
      total: 1,
      limit: 20,
      offset: 0,
    });
    queryClient.setQueryData(flagAdminKeys.listPage({ limit: 20, offset: 20 }), {
      items: [flag('other_flag')],
      total: 1,
      limit: 20,
      offset: 20,
    });
    queryClient.setQueryData(flagAdminKeys.listPage({ limit: 20, offset: 40 }), undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result: create } = renderHook(() => useCreateFlag(), { wrapper });
    await create.current.mutateAsync({
      key: 'brand_new',
      enabled: false,
      rolloutPct: 0,
      audience: 'portal',
    });

    const { result: update } = renderHook(() => useUpdateFlag(), { wrapper });
    await update.current.mutateAsync({ key: 'brand_new', changes: { enabled: true } });

    const { result: setOv } = renderHook(() => useSetOverride(), { wrapper });
    await setOv.current.mutateAsync({
      key: 'brand_new',
      principalId: ada.principalId,
      enabled: true,
    });

    const { result: del } = renderHook(() => useDeleteFlag(), { wrapper });
    await del.current.mutateAsync('hello_world');
    expect(queryClient.getQueryData(flagAdminKeys.listPage({ limit: 20, offset: 0 }))).toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('rejects unexpected response shapes across feature-flags API functions (lines 125, 150, 156, 172, 177, 201)', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValueOnce(Response.json({ items: [flag('hello_world')], total: 1, limit: 20, offset: 0 }));
    await expect(listFlags({ limit: 20, offset: 0 })).resolves.toMatchObject({ total: 1 });

    const invalidResponses: [() => Promise<unknown>, unknown][] = [
      [() => createFlag({ key: 'a', enabled: false, rolloutPct: 0, audience: 'portal' }), null],
      [() => createFlag({ key: 'a', enabled: false, rolloutPct: 0, audience: 'portal' }), { overrideCounts: null }],
      [() => createFlag({ key: 'a', enabled: false, rolloutPct: 0, audience: 'portal' }), { overrideCounts: {} }],
      [() => fetchFlag('hello_world'), null],
      [() => fetchFlag('hello_world'), { ...flag('hello_world'), overrides: [null] }],
      [() => setOverride('hello_world', 'p-1', true), null],
      [() => listHistory({ key: 'hello_world', limit: 20 }), null],
      [() => listHistory({ key: 'hello_world', limit: 20 }), { items: 'bad', older: null, newer: null }],
      [() => listHistory({ key: 'hello_world', limit: 20 }), { items: [null], older: null, newer: null }],
      [() => listHistory({ key: 'hello_world', limit: 20 }), { items: [{ actor: null }], older: null, newer: null }],
      [
        () => listHistory({ key: 'hello_world', limit: 20 }),
        { items: [{ actor: {}, changes: null }], older: null, newer: null },
      ],
      [
        () => listHistory({ key: 'hello_world', limit: 20 }),
        { items: [{ actor: {}, changes: {}, id: 'bad' }], older: null, newer: null },
      ],
      ...[
        { flagKey: 123 },
        { action: 'invalid' },
        { actor: { principalId: 123, name: 'Ada' } },
        { actor: { principalId: '1', name: 123 } },
        { subject: 'bad' },
        { subject: { principalId: 123 } },
        { createdAt: 123 },
      ].map((override): [() => Promise<unknown>, unknown] => [
        () => listHistory({ key: 'hello_world', limit: 20 }),
        {
          items: [
            {
              id: 1,
              flagKey: 'hello_world',
              action: 'created',
              actor: { principalId: '1', name: 'Ada' },
              subject: null,
              changes: {},
              createdAt: '2026-11-10T00:00:00Z',
              ...override,
            },
          ],
          older: null,
          newer: null,
        },
      ]),
      [() => listFlags({ limit: 20, offset: 0 }), null],
      [() => listFlags({ limit: 20, offset: 0 }), { items: 'bad' }],
      [() => searchPeople('ada', 'portal'), null],
    ];

    for (const [, body] of invalidResponses) fetchMock.mockResolvedValueOnce(Response.json(body));
    await Promise.all(
      invalidResponses.map(([call]) => expect(call()).rejects.toThrow('console-api request failed (unexpected)')),
    );
  });
});
