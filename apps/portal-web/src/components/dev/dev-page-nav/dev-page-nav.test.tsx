import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DevPageNav } from '.';

const items = [
  { id: 'usage', title: 'Usage' },
  { id: 'api', title: 'API' },
] as const;

describe('DevPageNav', () => {
  it('links to each section by its id and marks the first as current before any scrolling', () => {
    render(<DevPageNav items={items} />);

    const nav = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Usage', '#usage'],
      ['API', '#api'],
    ]);
    expect(links[0]).toHaveAttribute('aria-current', 'location');
    expect(links[1]).not.toHaveAttribute('aria-current');
  });
});
