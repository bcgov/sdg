import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NavLink } from './nav-link';

afterEach(cleanup);

describe('NavLink', () => {
  it('renders an anchor with the href and text', () => {
    render(<NavLink href="/api/auth/login">Sign in</NavLink>);
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/api/auth/login');
  });

  it('uses the nav item styling instead of the upstream link styling', () => {
    render(
      <NavLink href="/" className="extra">
        Home
      </NavLink>,
    );
    const link = screen.getByRole('link', { name: 'Home' });
    expect(link.className).toMatch(/navLink/);
    expect(link.className).toMatch(/\bextra\b/);
    expect(link.className).not.toMatch(/bcds-react-aria-Link/);
  });
});
