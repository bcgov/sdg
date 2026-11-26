import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PropTable } from '.';

const rows = [
  ['variant', "'primary' | 'warning'", "'primary'", 'The look.'],
  ['danger', 'boolean', 'false', 'Destructive.'],
] as const;

describe('PropTable', () => {
  it('names the table by its caption and has a row per prop', () => {
    render(<PropTable caption="Button props" rows={rows} />);

    const table = screen.getByRole('table', { name: 'Button props' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Prop', 'Type', 'Default', 'Notes']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['variant', 'danger']);
    expect(within(table).getByRole('row', { name: /danger/ })).toHaveTextContent('Destructive.');
  });
});
