import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from './button';

afterEach(cleanup);

describe('Button', () => {
  it('renders the upstream variants unchanged', () => {
    render(
      <Button variant="secondary" size="small" danger>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.className).toBe('bcds-react-aria-Button small secondary danger ');
  });

  it('keeps the upstream sizing classes and adds the warning class', () => {
    render(
      <Button variant="warning" size="large" className="extra">
        Proceed anyway
      </Button>,
    );
    const { classList } = screen.getByRole('button', { name: 'Proceed anyway' });
    expect(classList).toContain('bcds-react-aria-Button');
    expect(classList).toContain('large');
    expect(classList).toContain('extra');
    expect(classList.value).toMatch(/warning/);
    expect(classList).not.toContain('primary');
  });

  it('keeps the icon class on a warning button', () => {
    render(
      <Button variant="warning" isIconButton aria-label="Warn">
        !
      </Button>,
    );
    const { classList } = screen.getByRole('button', { name: 'Warn' });
    expect(classList).toContain('medium');
    expect(classList).toContain('icon');
  });

  it('lets danger win over warning', () => {
    render(
      <Button variant="warning" size="small" danger>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.className).toBe('bcds-react-aria-Button small primary danger ');
  });
});
