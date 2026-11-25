import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Details, type DetailsItem } from './details';

afterEach(cleanup);

// fileURLToPath on the string: jsdom replaces the global URL class.
const stylesheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'details.module.css'), 'utf8');

const NO_ITEMS: readonly DetailsItem[] = [];

const PROFILE: readonly DetailsItem[] = [
  { id: 'name', label: 'Full Name', value: 'Ada Lovelace' },
  { id: 'dob', label: 'Date of Birth', value: 'December 10, 1815' },
  { id: 'gender', label: 'Gender', value: 'Female' },
];

const WITH_AND_WITHOUT_EXTRA: readonly DetailsItem[] = [
  { id: 'name', label: 'Full Name', value: 'Ada Lovelace', extra: <a href="#name">Change</a> },
  { id: 'dob', label: 'Date of Birth', value: 'December 10, 1815' },
];

const ADDRESS: readonly DetailsItem[] = [
  {
    id: 'address',
    label: 'Address',
    value: (
      <>
        <span>1 Main St</span>
        <span>Victoria BC</span>
      </>
    ),
  },
];

describe('Details', () => {
  it('renders one description list with a label and value per item, in order', () => {
    const { container } = render(<Details items={PROFILE} />);
    expect(container.querySelector('dl')).not.toBeNull();
    expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      'Full Name',
      'Date of Birth',
      'Gender',
    ]);
    expect([...container.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual([
      'Ada Lovelace',
      'December 10, 1815',
      'Female',
    ]);
  });

  it('renders a second dd only for items with extra content', () => {
    const { container } = render(<Details items={WITH_AND_WITHOUT_EXTRA} />);
    const [withExtra, withoutExtra] = [...container.querySelectorAll('dl > div')];
    expect(withExtra?.querySelectorAll('dd')).toHaveLength(2);
    expect(withExtra?.querySelectorAll('dd')[1]?.querySelector('a')?.getAttribute('href')).toBe('#name');
    expect(withoutExtra?.querySelectorAll('dd')).toHaveLength(1);
  });

  it('renders an empty list for no items', () => {
    const { container } = render(<Details items={NO_ITEMS} />);
    expect(container.querySelector('dl')?.children).toHaveLength(0);
  });

  it('renders React node values unchanged', () => {
    render(<Details items={ADDRESS} />);
    expect(screen.getByText('1 Main St').tagName).toBe('SPAN');
    expect(screen.getByText('Victoria BC').tagName).toBe('SPAN');
  });

  it('labels the list and merges className when given', () => {
    const { container } = render(<Details items={NO_ITEMS} aria-label="Profile" className="extra" />);
    const list = container.querySelector('dl');
    expect(list?.getAttribute('aria-label')).toBe('Profile');
    expect(list?.className).toMatch(/\bextra\b/);
  });

  it('adds the bordered class only when bordered', () => {
    const { container, rerender } = render(<Details items={PROFILE} />);
    expect(container.querySelector('dl')?.className).not.toMatch(/bordered/);
    rerender(<Details items={PROFILE} bordered />);
    expect(container.querySelector('dl')?.className).toMatch(/bordered/);
  });

  it('borders the list and divides its rows', () => {
    expect(stylesheet).toMatch(/\.bordered \{[^}]*border: [^}]*;/u);
    expect(stylesheet).toMatch(/\.bordered > \.row \+ \.row \{[^}]*border-top: [^}]*;/u);
  });

  it('aligns extra content to the end of the row, and to the start once stacked', () => {
    expect(stylesheet).toMatch(/\n\.extra \{[^}]*text-align: end;/u);
    expect(stylesheet).toMatch(/@media \(max-width: 768px\) \{[^@]*\.extra \{[^}]*text-align: start;/u);
  });

  it('stacks rows into one column at phone width', () => {
    const phone = /@media \(max-width: 768px\) \{[^@]*\.row \{[^}]*grid-template-columns: 1fr;/u;
    expect(stylesheet).toMatch(phone);
  });
});
