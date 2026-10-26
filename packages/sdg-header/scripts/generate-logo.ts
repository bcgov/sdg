// Rewrites src/logo.ts from the installed @bcgov/design-system-react-components (`pnpm generate:logo`).
// logo.test.ts fails when an upstream bump changes the logo; run this, then review the diff.
import { writeFileSync } from 'node:fs';

import { extractBcLogo, logoModule } from './bc-logo.ts';

const target = new URL('../src/logo.ts', import.meta.url);

try {
  writeFileSync(target, logoModule(extractBcLogo()));
  console.log(`generate-logo: wrote ${target.pathname}`);
} catch (error) {
  console.error('generate-logo: could not regenerate the B.C. logo', error);
  process.exitCode = 1;
}
