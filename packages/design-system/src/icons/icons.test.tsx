import * as freeRegular from '@fortawesome/free-regular-svg-icons';
import * as freeSolid from '@fortawesome/free-solid-svg-icons';
import * as reactFontAwesome from '@fortawesome/react-fontawesome';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../components/button';
import * as icons from './index';

interface IconLike {
  prefix: string;
  iconName: string;
}

function iconsIn(values: unknown[]): IconLike[] {
  return values.filter(
    (value): value is IconLike =>
      typeof value === 'object' && value !== null && 'prefix' in value && 'iconName' in value,
  );
}

const iconExports: Record<string, unknown> = icons;

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

describe('icons subpath', () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  it('exports FontAwesomeIcon from react-fontawesome', () => {
    expect(icons.FontAwesomeIcon).toBe(reactFontAwesome.FontAwesomeIcon);
  });

  it('exports every free solid icon with flat fa* names', () => {
    for (const [name, value] of Object.entries(freeSolid)) {
      expect(iconExports[name]).toBe(value);
    }
    expect(icons.faUser.prefix).toBe('fas');
    expect(icons.faUser.iconName).toBe('user');
  });

  it('exports the free regular icons under the regular namespace', () => {
    expect(Object.keys(icons.regular).toSorted()).toEqual(Object.keys(freeRegular).toSorted());
    expect(icons.regular.faUser.prefix).toBe('far');
    expect(icons.regular.faUser).not.toBe(icons.faUser);
  });

  it('exposes only free solid and regular icons (no brands, no pro)', () => {
    const flat = iconsIn(Object.values(icons));
    const namespaced = iconsIn(Object.values(icons.regular));
    expect(flat.length).toBeGreaterThan(1000);
    expect(new Set(flat.map((icon) => icon.prefix))).toEqual(new Set(['fas']));
    expect(new Set(namespaced.map((icon) => icon.prefix))).toEqual(new Set(['far']));
  });

  it('renders a Font Awesome icon inside a design-system Button', async () => {
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Button variant="primary">
          <icons.FontAwesomeIcon icon={icons.faUser} /> Profile
        </Button>,
      );
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Profile');
    const svg = button?.querySelector('svg');
    expect(svg?.getAttribute('data-icon')).toBe('user');
    expect(svg?.getAttribute('data-prefix')).toBe('fas');

    await act(async () => root.unmount());
  });
});
