import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContactInformation, type ContactItem } from '.';
import { SERVICE_BC_CONTACTS, SERVICE_BC_HOURS } from './service-bc';

const MIXED: readonly ContactItem[] = [
  { type: 'phone', label: 'Outside Canada', description: [{ value: '+1 (250) 387-6121' }] },
  { type: 'fax', label: 'Fax', description: [{ value: '250-386-5604' }] },
  { type: 'email', label: 'E-mail', description: [{ value: 'servicebc@gov.bc.ca' }] },
];

/** The top-level cards (the entry lists nest their own list items). */
function cards(): HTMLElement[] {
  return within(screen.getAllByRole('list')[0]!)
    .getAllByRole('listitem')
    .filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
}

const ALL: readonly ContactItem[] = [...SERVICE_BC_CONTACTS, ...MIXED];

/** Each entry in a card as [its label, or null, and its link's href]. */
function entries(card: HTMLElement | undefined) {
  return [...card!.querySelectorAll('ul > li')].map((entry) => [
    entry.querySelector('span')?.textContent ?? null,
    entry.querySelector('a')?.getAttribute('href'),
  ]);
}

describe('ContactInformation', () => {
  it('renders a region headed Contact information, with the description and one card per item', () => {
    render(<ContactInformation description={SERVICE_BC_HOURS} items={SERVICE_BC_CONTACTS} />);
    const region = screen.getByRole('region', { name: 'Contact information' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Contact information' })).toBeInTheDocument();
    expect(within(region).getByText(SERVICE_BC_HOURS).tagName).toBe('P');
    expect(cards().map((card) => card.querySelector('p')?.textContent)).toEqual([
      'Call Service BC at',
      'Video Relay Service (VRS)',
      'Telephone Device for the Deaf (TDD):',
    ]);
  });

  it('lists each entry with its optional label above its link', () => {
    render(<ContactInformation items={SERVICE_BC_CONTACTS} />);
    const [call, vrs, tdd] = cards();
    expect(entries(call)).toEqual([
      ['Canada and USA toll free:', 'tel:18883562741'],
      ['Lower Mainland or outside Canada and USA:', 'tel:6046602355'],
    ]);
    expect(entries(vrs)).toEqual([
      [null, 'tel:18006637867'],
      ['Outside of Canada/USA:', 'tel:6046602355'],
    ]);
    expect(entries(tdd)).toEqual([['Across B.C.:', 'tel:711']]);
  });

  it('links numbers with tel: (keeping a leading +) and addresses with mailto:', () => {
    render(<ContactInformation items={MIXED} />);
    expect(screen.getByRole('link', { name: '+1 (250) 387-6121' })).toHaveAttribute('href', 'tel:+12503876121');
    expect(screen.getByRole('link', { name: '250-386-5604' })).toHaveAttribute('href', 'tel:2503865604');
    expect(screen.getByRole('link', { name: 'servicebc@gov.bc.ca' })).toHaveAttribute(
      'href',
      'mailto:servicebc@gov.bc.ca',
    );
  });

  it('picks each icon from the type, hidden from assistive technology', () => {
    render(<ContactInformation items={ALL} />);
    const icons = cards().map((card) => card.querySelector('svg'));
    expect(icons.map((icon) => icon?.getAttribute('data-icon'))).toEqual([
      'phone',
      'video',
      'tty',
      'phone',
      'fax',
      'at',
    ]);
    for (const icon of icons) expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders no description paragraph when none is given', () => {
    render(<ContactInformation items={SERVICE_BC_CONTACTS} />);
    const list = screen.getAllByRole('list')[0]!;
    expect(list.parentElement?.firstElementChild).toBe(list);
  });
});
