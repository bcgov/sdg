import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ExamplePreview } from '.';

describe('ExamplePreview', () => {
  it('shows the example with its code hidden', () => {
    render(
      <ExamplePreview label="Basic" code="<p>Example</p>">
        <p>Example</p>
      </ExamplePreview>,
    );

    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show code' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('<p>Example</p>')).not.toBeInTheDocument();
  });

  it('shows and hides the code from the toggle', async () => {
    const user = userEvent.setup();
    render(
      <ExamplePreview label="Basic" code="<p>Example</p>">
        <p>Example</p>
      </ExamplePreview>,
    );

    await user.click(screen.getByRole('button', { name: 'Show code' }));

    const toggle = screen.getByRole('button', { name: 'Hide code' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toHaveTextContent('<p>Example</p>');
    expect(screen.getByRole('button', { name: 'Copy Basic code' })).toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Show code' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('<p>Example</p>')).not.toBeInTheDocument();
  });
});
