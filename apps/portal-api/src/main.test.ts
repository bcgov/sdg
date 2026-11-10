import { startService } from '@repo/server-core/nestjs';
import { describe, expect, it, vi } from 'vitest';

import { AppModule } from './app.module.js';

vi.mock(import('@repo/server-core/nestjs'), async (importOriginal) => ({
  ...(await importOriginal()),
  startService: vi.fn<typeof startService>(async () => undefined),
}));
// The real AppModule validates the environment when it is defined; main.ts only hands it to startService.
vi.mock('./app.module.js', () => ({ AppModule: { name: 'AppModule stub' } }));

describe('main', () => {
  it('starts portal-api with rawBody, which bff-core needs to forward JSON and form bodies byte for byte', async () => {
    await import('./main.js');
    expect(startService).toHaveBeenCalledExactlyOnceWith(
      AppModule,
      expect.objectContaining({ serviceName: 'portal-api', rawBody: true }),
    );
  });
});
