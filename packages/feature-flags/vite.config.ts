import { fileURLToPath } from 'node:url';

import { defineLibraryConfig } from '@repo/vite-config';

// React and TanStack Query stay external (peers): the app's copies hold the QueryClient the provider reads.
export default defineLibraryConfig({
  platform: 'react',
  entry: { index: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
});
