import type { TanStackDevtoolsReactPlugin } from '@tanstack/react-devtools';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DevtoolsProps = { plugins: TanStackDevtoolsReactPlugin[] };
const mockTanStackDevtools = vi.fn<(props: DevtoolsProps) => void>();

vi.mock('@tanstack/react-devtools', () => ({
  TanStackDevtools: (props: DevtoolsProps) => {
    mockTanStackDevtools(props);
    return (
      <div data-testid="mock-tanstack-devtools">
        {props.plugins.map((plugin) => {
          const pluginName = typeof plugin.name === 'string' ? plugin.name : 'plugin';
          const renderContent = typeof plugin.render === 'function' ? null : plugin.render;
          return (
            <div key={pluginName} data-testid={`plugin-${pluginName}`}>
              {renderContent}
            </div>
          );
        })}
      </div>
    );
  },
}));

vi.mock('@tanstack/react-query-devtools', () => ({
  ReactQueryDevtoolsPanel: () => <div data-testid="query-devtools-panel" />,
}));

vi.mock('@tanstack/react-router-devtools', () => ({
  TanStackRouterDevtoolsPanel: () => <div data-testid="router-devtools-panel" />,
}));

import DevtoolsPanels from './panels';

describe('DevtoolsPanels Component Test Suite', () => {
  beforeEach(() => {
    mockTanStackDevtools.mockClear();
  });

  it('Should render TanStackDevtools with TanStack Query and TanStack Router plugins configured', () => {
    render(<DevtoolsPanels />);

    expect(screen.getByTestId('mock-tanstack-devtools')).toBeInTheDocument();
    expect(mockTanStackDevtools).toHaveBeenCalledTimes(1);

    const [callProps] = mockTanStackDevtools.mock.calls[0] ?? [{ plugins: [] }];
    expect(callProps.plugins).toHaveLength(2);

    expect(screen.getByTestId('plugin-TanStack Query')).toContainElement(screen.getByTestId('query-devtools-panel'));
    expect(screen.getByTestId('plugin-TanStack Router')).toContainElement(screen.getByTestId('router-devtools-panel'));
  });
});
