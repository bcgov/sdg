import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('./index');

vi.mock('@tanstack/react-devtools', () => ({
  TanStackDevtools: () => <div data-testid="tanstack-devtools" />,
}));
vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtoolsPanel: () => <div />,
}));
vi.mock('@tanstack/react-router-devtools', () => ({
  TanStackRouterDevtoolsPanel: () => <div />,
}));

import { Devtools } from './index';

describe('Devtools', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('lazy-loads DevtoolsPanels when DEV is true', async () => {
    render(<Devtools />);
    expect(await screen.findByTestId('tanstack-devtools')).toBeInTheDocument();
  });

  it('renders nothing when DEV is false', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    const { Devtools: ProdDevtools } = await import('./index');
    const { container } = render(<ProdDevtools />);
    expect(container).toBeEmptyDOMElement();
  });
});
