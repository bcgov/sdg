import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadSdgHeader = vi.fn<() => Promise<void>>();
const startTelemetry = vi.fn<() => Promise<void>>();
const setUpFontAwesome = vi.fn<() => void>();
const render = vi.fn<() => void>();
const createRoot = vi.fn<(container: HTMLElement) => { render: typeof render }>(() => ({ render }));
const createAppRouter = vi.fn<() => Record<string, never>>(() => ({}));

vi.mock('@repo/shared-ui/header/react', () => ({ loadSdgHeader }));
vi.mock('./telemetry', () => ({ startTelemetry }));
vi.mock('./font-awesome', () => ({ setUpFontAwesome }));
vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('./router', () => ({ createAppRouter }));
vi.mock('./app', () => ({ App: () => null }));

describe('portal-web entry point', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadSdgHeader.mockResolvedValue(undefined);
    startTelemetry.mockResolvedValue(undefined);
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('starts loading <sdg-header> before mounting React into #root', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);

    await import('./main');

    expect(setUpFontAwesome).toHaveBeenCalledOnce();
    expect(loadSdgHeader).toHaveBeenCalledOnce();
    expect(startTelemetry).toHaveBeenCalledOnce();
    expect(createRoot).toHaveBeenCalledWith(root);
    expect(render).toHaveBeenCalledOnce();
    expect(loadSdgHeader.mock.invocationCallOrder[0]).toBeLessThan(createRoot.mock.invocationCallOrder[0]!);
  });

  it('still mounts when the header loader rejects', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    loadSdgHeader.mockRejectedValue(new Error('HTTP 404'));

    await import('./main');
    await Promise.resolve();

    expect(loadSdgHeader).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it('throws when #root is missing', async () => {
    await expect(import('./main')).rejects.toThrow('#root element missing');
  });

  it('preloads the header loader script in index.html', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
    expect(html).toContain(
      '<link rel="preload" href="/shared-ui/header/v1/loader.js" as="script" crossorigin="anonymous" />',
    );
  });
});
