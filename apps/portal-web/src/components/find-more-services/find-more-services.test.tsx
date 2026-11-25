import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FindMoreServices } from '.';

describe('FindMoreServices', () => {
  it('renders a region headed Find more services, with its description and three services', () => {
    render(<FindMoreServices />);
    const region = screen.getByRole('region', { name: 'Find more services' });
    expect(region).toHaveTextContent("Looking for a service that isn't available here yet?");
    expect(
      within(region)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Service BC', 'FrontCounter BC', 'Courthouses']);
  });

  it('lists each service’s links in order', () => {
    render(<FindMoreServices />);
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Learn more about Service BC', '#'],
      ['Book an appointment', '#'],
      ['Learn more about FrontCounter BC', '#'],
      ['Find Courthouse locations', '#'],
    ]);
  });

  it('shows each service’s icon, hidden from assistive technology', () => {
    render(<FindMoreServices />);
    const icons = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.closest('li')?.querySelector('svg'));
    expect(icons.map((icon) => icon?.getAttribute('data-icon'))).toEqual(['circle-info', 'shop', 'landmark']);
    for (const icon of icons) expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
