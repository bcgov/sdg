import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CodeBlock } from '.';

describe('CodeBlock', () => {
  it('shows the code', () => {
    render(<CodeBlock code="const a = 1;" />);

    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
  });

  it('has no copy button without a label', () => {
    render(<CodeBlock code="const a = 1;" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('copies the code and says so when a label names it', async () => {
    // user-event stands in for the clipboard, which jsdom lacks.
    const user = userEvent.setup();
    render(<CodeBlock code="const a = 1;" label="Usage" />);

    await user.click(screen.getByRole('button', { name: 'Copy Usage code' }));

    expect(await navigator.clipboard.readText()).toBe('const a = 1;');
    expect(await screen.findByRole('button', { name: 'Usage code copied' })).toBeInTheDocument();
  });
});
