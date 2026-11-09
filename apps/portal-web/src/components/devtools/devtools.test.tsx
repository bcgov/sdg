import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./panels', () => ({
  default: () => <div data-testid="devtools-panels">Mocked Devtools Panels</div>,
}));

describe('Devtools Component Test Suite', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('Should render DevtoolsPanels inside Suspense when import.meta.env.DEV is true', async () => {
    vi.stubEnv('DEV', true);
    const { Devtools } = await import('./index');

    render(<Devtools />);

    expect(await screen.findByTestId('devtools-panels')).toBeInTheDocument();
  });

  it('Should render null when import.meta.env.DEV is false', async () => {
    vi.stubEnv('DEV', false);
    const { Devtools } = await import('./index');

    const { container } = render(<Devtools />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('devtools-panels')).not.toBeInTheDocument();
  });
});
