import { afterEach, describe, expect, it, vi } from 'vitest';

import { definePlaywrightConfig } from './index.ts';

afterEach(() => vi.unstubAllEnvs());

describe('definePlaywrightConfig', () => {
  it('uses local defaults outside CI', () => {
    vi.stubEnv('CI', '');
    const config = definePlaywrightConfig({ baseURL: 'http://localhost:5173' });
    expect(config.testDir).toBe('./e2e');
    expect(config.forbidOnly).toBe(false);
    expect(config.retries).toBe(0);
    expect(config.use?.baseURL).toBe('http://localhost:5173');
    expect(config.use?.trace).toBe('on-first-retry');
  });

  it('tightens settings in CI', () => {
    vi.stubEnv('CI', 'true');
    const config = definePlaywrightConfig({ baseURL: 'http://localhost:5173' });
    expect(config.forbidOnly).toBe(true);
    expect(config.retries).toBe(2);
    expect(config.reporter).toEqual([['html', { open: 'never' }], ['github']]);
  });

  it('defines chromium, firefox and webkit projects', () => {
    const config = definePlaywrightConfig({ baseURL: 'http://localhost:5173' });
    expect(config.projects?.map((p) => p.name)).toEqual(['chromium', 'firefox', 'webkit']);
  });

  it('reuses an existing dev server locally but not in CI', () => {
    vi.stubEnv('CI', '');
    const local = definePlaywrightConfig({ baseURL: 'http://localhost:5173', webServer: { command: 'pnpm dev' } });
    expect(local.webServer).toMatchObject({
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    });
    vi.stubEnv('CI', 'true');
    const ci = definePlaywrightConfig({ baseURL: 'http://localhost:5173', webServer: { command: 'pnpm dev' } });
    expect(ci.webServer).toMatchObject({ reuseExistingServer: false });
  });

  it('omits webServer when none is given', () => {
    expect(definePlaywrightConfig({ baseURL: 'https://example.test' }).webServer).toBeUndefined();
  });
});
