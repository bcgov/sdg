import '@repo/design-system/fonts.css';
import '@repo/design-system/styles.css';
// Reserves the header's height until the edge-served <sdg-header> script defines the element (R20).
import '@repo/shared-ui/header/preload.css';
import './styles.css';
import { QueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { startHeader } from './components/site-header';
import { setUpFontAwesome } from './font-awesome';
import { createAppRouter } from './router';
import { startTelemetry } from './telemetry';

setUpFontAwesome();

// Start loading the edge-served <sdg-header> before React mounts so it overlaps initial render.
void startHeader();

// Browser telemetry, only when the edge's /telemetry.json enables it; never blocks or breaks rendering.
void startTelemetry();

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
