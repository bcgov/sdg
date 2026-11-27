import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TextField } from './text-field';

afterEach(cleanup);

const onOrOff = ({ isDisabled }: { isDisabled: boolean }) => (isDisabled ? 'off' : 'on');

function field(name: string): HTMLElement {
  const root = screen.getByRole('textbox', { name }).closest('.react-aria-TextField, .bcds-react-aria-TextField');
  if (!(root instanceof HTMLElement)) throw new Error(`No TextField root for ${name}`);
  return root;
}

describe('TextField', () => {
  it('renders the upstream sizes unchanged', () => {
    render(<TextField label="Name" size="small" />);
    const root = field('Name');
    expect(root.className).toBe('bcds-react-aria-TextField');
    expect(root.querySelector('.bcds-react-aria-TextField--container')?.classList).toContain('small');
  });

  it.each(['xsmall', 'large'] as const)('keeps the upstream classes and adds the %s class', (size) => {
    render(<TextField label="Name" size={size} className="extra" />);
    const root = field('Name');
    expect(root.classList).toContain('bcds-react-aria-TextField');
    expect(root.classList).toContain('extra');
    expect(root.className).toMatch(new RegExp(size));
    // The size rules outrank upstream's by naming its container's `medium` class.
    expect(root.querySelector('.bcds-react-aria-TextField--container')?.classList).toContain('medium');
  });

  it('adds the size class to a className function', () => {
    render(<TextField label="Name" size="large" className={onOrOff} />);
    const { classList } = field('Name');
    expect(classList).toContain('bcds-react-aria-TextField');
    expect(classList).toContain('on');
  });
});
