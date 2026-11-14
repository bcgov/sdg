import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { nestError } from '../../test-support/fake-console-api';
import { fakeFeatureFlagsApi, flag, overrideFor, person } from '../../test-support/fake-feature-flags-api';
import { renderAt } from '../../test-support/render';
import { tabTo } from '../../test-support/shell';

const LIST = '/api/v1/console/feature-flags';

const findTable = () => screen.findByRole('table', { name: /Every feature flag/ });

describe('the feature flag list (R14, R21)', () => {
  it('shows each flag with its key, audience, switch, rollout and override counts', async () => {
    const [ada, bob, cy] = [person('Ada', 'resident'), person('Bob', 'resident'), person('Cy', 'console-user')];
    fakeFeatureFlagsApi({
      flags: [
        flag('new_search', { enabled: false, rolloutPct: 0, audience: 'console', overrides: [overrideFor(cy, true)] }),
        flag('hello_world', {
          enabled: true,
          rolloutPct: 50,
          overrides: [overrideFor(ada, true), overrideFor(bob, false)],
        }),
      ],
    });
    renderAt('/feature-flags');
    const rows = within(await findTable()).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'KeyAudienceSwitchRolloutOverrides',
      'hello_worldPortalOn50%1 on, 1 off',
      'new_searchConsoleOff0%1 on, 0 off',
    ]);
    expect(within(rows[1]!).getByRole('link', { name: 'hello_world' })).toHaveAttribute(
      'href',
      '/feature-flags/hello_world',
    );
    expect(screen.queryByRole('region', { name: 'Create a feature flag' })).toBeNull();
  });

  it('opens a flag’s page from its row’s key link, reachable with Tab', async () => {
    fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    const { router } = renderAt('/feature-flags');
    const user = userEvent.setup();
    await tabTo(user, within(await findTable()).getByRole('link', { name: 'hello_world' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Feature flag' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Flag details' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/feature-flags/hello_world');
  });

  it('says none exist yet in a fresh environment', async () => {
    fakeFeatureFlagsApi();
    renderAt('/feature-flags');
    expect(await screen.findByText('No feature flags exist yet.')).toBeInTheDocument();
  });

  it('offers a retry when the list cannot be loaded (503)', async () => {
    const api = fakeFeatureFlagsApi({ flags: [flag('hello_world')] });
    api.refuseNext('GET', LIST, () => nestError(503, 'Service Unavailable'));
    renderAt('/feature-flags');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The feature flags couldn't be loaded");
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('row', { name: /^hello_world / })).toBeInTheDocument();
  });
});
