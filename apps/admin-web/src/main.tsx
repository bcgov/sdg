import '@repo/design-system/fonts.css';
import '@repo/design-system/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createQueryClient } from './api/query-client';
import { App } from './app';
import { createAppRouter } from './router';
import { startTelemetry } from './telemetry';

// Browser telemetry, only when the edge's /telemetry.json enables it; never blocks or breaks rendering.
void startTelemetry();

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('admin-web: #root element missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);
