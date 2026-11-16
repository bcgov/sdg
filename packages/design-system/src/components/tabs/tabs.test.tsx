import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Tab, TabList, TabPanel, Tabs } from './tabs';

function Example() {
  return (
    <Tabs>
      <TabList aria-label="Flag">
        <Tab id="one">One</Tab>
        <Tab id="two">Two</Tab>
      </TabList>
      <TabPanel id="one">First panel</TabPanel>
      <TabPanel id="two">Second panel</TabPanel>
    </Tabs>
  );
}

afterEach(cleanup);

describe('Tabs', () => {
  it('shows the first tab’s panel, labelled by its tab, and switches with the arrow keys', async () => {
    render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Flag' })).not.toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'One' }).textContent).toBe('First panel');
    expect(screen.queryByText('Second panel')).toBeNull();

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Two' }).textContent).toBe('Second panel');
  });

  it('adds a given class name to its own', () => {
    render(
      <Tabs className="extra">
        <TabList aria-label="Flag">
          <Tab id="one">One</Tab>
        </TabList>
        <TabPanel id="one">First panel</TabPanel>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'One' }).closest('.extra')).not.toBeNull();
  });
});
