import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Section } from './section';

afterEach(cleanup);

const bar = (container: HTMLElement) => container.querySelector('[class*="bar"]');

describe('Section', () => {
  it('renders a region named by its title, with the heading block before the children', () => {
    const { container } = render(
      <Section title="Profile" description="Your BC Services Card details.">
        <p>Body</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Profile' });
    expect(region.tagName).toBe('SECTION');
    expect(screen.getByRole('heading', { level: 2, name: 'Profile' })).toBeTruthy();
    expect(region.textContent).toBe('ProfileYour BC Services Card details.Body');
    expect(screen.getByText('Your BC Services Card details.').tagName).toBe('P');
    expect(bar(container)).not.toBeNull();
  });

  it('renders only the children, with no heading block or bar, when there is no title or description', () => {
    const { container } = render(
      <Section>
        <p>Body</p>
      </Section>,
    );
    const section = container.querySelector('section');
    expect(section?.children).toHaveLength(1);
    expect(section?.firstElementChild?.textContent).toBe('Body');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(bar(container)).toBeNull();
  });

  it('renders the description and children without a bar or accessible name when there is no title', () => {
    const { container } = render(
      <Section description="About this page.">
        <p>Body</p>
      </Section>,
    );
    const section = container.querySelector('section');
    expect(section?.hasAttribute('aria-labelledby')).toBe(false);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByText('About this page.').tagName).toBe('P');
    expect(screen.getByText('Body')).toBeTruthy();
    expect(bar(container)).toBeNull();
  });

  it('renders the heading block alone when there are no children', () => {
    const { container } = render(<Section title="Data & Privacy" description="Placeholder." />);
    const section = container.querySelector('section');
    expect(section?.children).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Data & Privacy' })).toBeTruthy();
  });

  it('merges className onto the section element', () => {
    const { container } = render(<Section title="Profile" className="extra" />);
    expect(container.querySelector('section')?.className).toMatch(/\bextra\b/);
  });
});
