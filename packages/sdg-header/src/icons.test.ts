import { describe, expect, it, vi } from 'vitest';

import { mount, shadow, stubMatchMedia } from './test-support/mount.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('icons', () => {
  // A <path> created in the HTML namespace renders nothing, so the hamburger would be an empty button.
  it.each([
    ['bars', false],
    ['xmark', true],
  ])('renders the %s hamburger icon as real SVG paths', async (iconName, open) => {
    stubMatchMedia(true);
    const element = await mount({ navItems: [{ label: 'Home', href: '/' }] });
    const toggle = shadow(element).getByRole('button', { name: 'Menu' });
    if (open) {
      toggle.click();
      await element.updateComplete;
    }
    const paths = Array.from(toggle.querySelectorAll(`svg[data-icon="${iconName}"] > *`));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.namespaceURI === SVG_NS && path.localName === 'path')).toBe(true);
    expect(paths.every((path) => (path.getAttribute('d') ?? '').length > 10)).toBe(true);
  });

  it('renders the Log out icon as real SVG paths', async () => {
    const element = await mount({ user: { name: 'Ada Lovelace' }, signOutFn: vi.fn<() => void>() });
    shadow(element).getByRole('button', { name: 'Account menu for Ada Lovelace' }).click();
    await element.updateComplete;
    const path = element.shadowRoot!.querySelector('svg[data-icon="right-from-bracket"] > *');
    expect(path?.namespaceURI).toBe(SVG_NS);
    expect(path?.localName).toBe('path');
  });
});
