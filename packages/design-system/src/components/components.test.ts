import * as upstream from '@bcgov/design-system-react-components';
import { describe, expect, it } from 'vitest';

// No type argument on import.meta.glob: Vite skips the transform when the call is `glob<…>(`.
const modules: Record<string, Record<string, unknown>> = import.meta.glob('./*/index.ts', { eager: true });
const subpaths: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(modules).map(([path, mod]) => [path.slice(2, -'/index.ts'.length), mod]),
);

// Components built in this package rather than re-exported from upstream.
const custom: Record<string, string[]> = {
  avatar: ['Avatar', 'getInitials'],
  'nav-link': ['NavLink'],
};
const wrapped: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(subpaths).filter(([subpath]) => !(subpath in custom)),
);

// The expected subpath table: one entry per wrapped component subpath.
const expected: Record<string, string[]> = {
  accordion: ['Accordion', 'AccordionGroup'],
  'alert-banner': ['AlertBanner'],
  'alert-dialog': ['AlertDialog'],
  button: ['Button'],
  'button-group': ['ButtonGroup'],
  calendar: ['Calendar'],
  callout: ['Callout'],
  checkbox: ['Checkbox', 'CheckboxGroup'],
  'date-picker': ['DatePicker'],
  dialog: ['Dialog', 'DialogTrigger'],
  footer: ['Footer', 'FooterLinks'],
  form: ['Form'],
  header: ['Header'],
  heading: ['Heading'],
  'inline-alert': ['InlineAlert'],
  link: ['Link'],
  menu: ['Menu', 'MenuItem', 'MenuSection', 'MenuSectionHeader', 'MenuTrigger', 'SubmenuTrigger'],
  modal: ['Modal'],
  'number-field': ['NumberField'],
  'progress-bar': ['ProgressBar'],
  'progress-circle': ['ProgressCircle'],
  radio: ['Radio', 'RadioGroup'],
  select: ['Select'],
  separator: ['Separator'],
  subheader: ['Subheader'],
  switch: ['Switch'],
  tag: ['Tag', 'TagGroup', 'TagList'],
  text: ['Text'],
  'text-area': ['TextArea'],
  'text-field': ['TextField'],
  'time-field': ['TimeField'],
  'toggle-button': ['ToggleButton', 'ToggleButtonGroup'],
  tooltip: ['Tooltip', 'TooltipTrigger'],
};

const upstreamExports: Record<string, unknown> = upstream;
const upstreamComponents = Object.keys(upstreamExports).filter((name) => !name.startsWith('Svg'));
const upstreamSvgIcons = Object.keys(upstreamExports).filter((name) => name.startsWith('Svg'));

describe('component subpaths', () => {
  it('match the documented subpath table', () => {
    const actual = Object.fromEntries(
      Object.entries(subpaths).map(([subpath, mod]) => [subpath, Object.keys(mod).toSorted()]),
    );
    const documented = Object.fromEntries(
      Object.entries({ ...expected, ...custom }).map(([subpath, names]) => [subpath, names.toSorted()]),
    );
    expect(actual).toEqual(documented);
  });

  it('use kebab-case folder names', () => {
    expect(Object.keys(subpaths)).not.toHaveLength(0);
    for (const subpath of Object.keys(subpaths)) {
      expect(subpath).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('re-export the upstream components by reference', () => {
    expect(Object.keys(wrapped)).not.toHaveLength(0);
    for (const mod of Object.values(wrapped)) {
      for (const [name, value] of Object.entries(mod)) {
        expect(value).toBeDefined();
        expect(value).toBe(upstreamExports[name]);
      }
    }
  });

  it('cover every non-Svg upstream export exactly once', () => {
    const exported = Object.values(wrapped).flatMap((mod) => Object.keys(mod));
    expect(exported.toSorted()).toEqual(upstreamComponents.toSorted());
    expect(new Set(exported).size).toBe(exported.length);
  });

  it('keep custom components out of the upstream namespace', () => {
    for (const subpath of Object.keys(custom)) {
      const mod = subpaths[subpath];
      expect(mod).toBeDefined();
      for (const [name, value] of Object.entries(mod ?? {})) {
        expect(typeof value).toBe('function');
        expect(name in upstreamExports).toBe(false);
      }
    }
  });

  it('never expose the upstream Svg icons', () => {
    expect(Object.keys(subpaths)).not.toHaveLength(0);
    expect(upstreamSvgIcons.length).toBeGreaterThan(0);
    const svgValues = new Set(upstreamSvgIcons.map((name) => upstreamExports[name]));
    for (const [subpath, mod] of Object.entries(subpaths)) {
      for (const [name, value] of Object.entries(mod)) {
        expect(`${subpath}:${name}`).not.toMatch(/:Svg/);
        expect(svgValues.has(value)).toBe(false);
      }
    }
  });
});
