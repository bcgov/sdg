import '@fortawesome/fontawesome-svg-core/styles.css';
import '@repo/design-system/fonts.css';
import '@repo/design-system/styles.css';
import './styles.css';
import { config as fontAwesomeConfig } from '@fortawesome/fontawesome-svg-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createQueryClient } from './api/query-client';
import { App } from './app';
import { createAppRouter } from './router';
import { startTelemetry } from './telemetry';

// FontAwesome would otherwise prepend a <style> on the first icon render, which the edge CSP blocks; its stylesheet is
// imported above instead.
fontAwesomeConfig.autoAddCss = false;

// Browser telemetry, only when the edge's /telemetry.json enables it; never blocks or breaks rendering.
void startTelemetry();

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('console-web: #root element missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);
