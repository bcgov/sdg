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

  it('lists each service’s links in order, each opening in a new tab', () => {
    render(<FindMoreServices />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      [
        'Learn more about Service BC',
        'https://www2.gov.bc.ca/gov/content/governments/organizational-structure/ministries-organizations/ministries/citizens-services/servicebc',
      ],
      ['Book an appointment', 'https://appointments.servicebc.gov.bc.ca/appointmentt'],
      [
        'Learn more about FrontCounter BC',
        'https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/natural-resource-permits/fcbc-locations',
      ],
      [
        'Find courthouse locations',
        'https://www2.gov.bc.ca/gov/content/justice/courthouse-services/courthouse-locations',
      ],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleName(`${link.textContent} (opens in a new tab)`);
    }
  });

  it('insets its title bar by the body’s 24px padding, so the title lines up with the content', () => {
    render(<FindMoreServices />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Find more services' });
    expect(heading.className).toMatch(/inset-large/);
    expect(heading.nextElementSibling?.className).toMatch(/padding-large/);
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
