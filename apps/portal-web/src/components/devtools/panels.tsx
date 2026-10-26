import { TanStackDevtools, type TanStackDevtoolsReactPlugin } from '@tanstack/react-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

const plugins: TanStackDevtoolsReactPlugin[] = [
  { name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
  { name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> },
];

export default function DevtoolsPanels() {
  return <TanStackDevtools plugins={plugins} />;
}
