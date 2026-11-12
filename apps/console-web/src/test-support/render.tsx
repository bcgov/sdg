import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';

import { createQueryClient } from '../api/query-client';
import { App } from '../app';
import { createAppRouter } from '../router';

export function renderAt(path: string) {
  const queryClient = createQueryClient();
  const router = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<App queryClient={queryClient} router={router} />);
  return { queryClient, router };
}
