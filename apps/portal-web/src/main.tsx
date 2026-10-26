import '@repo/design-system/fonts.css';
import '@repo/design-system/styles.css';
import './styles.css';
import { QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { createAppRouter } from './router';

const queryClient = new QueryClient();
const router = createAppRouter({ queryClient });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('portal-web: #root element missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);
