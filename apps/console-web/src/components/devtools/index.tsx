import { lazy, Suspense } from 'react';

// `import.meta.env.DEV` is statically false in production builds, so the panels chunk is never emitted.
const DevtoolsPanels = import.meta.env.DEV ? lazy(() => import('./panels')) : null;

export function Devtools() {
  return DevtoolsPanels ? (
    <Suspense>
      <DevtoolsPanels />
    </Suspense>
  ) : null;
}
