/** @jsxImportSource react */
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdgLoginEvent, SdgLogoutEvent, SdgSettingsEvent } from '../types.js';

type Wrapper = typeof import('./sdg-header.js');

const INTEGRITY = `sha384-${'A'.repeat(64)}`;

// A fresh module graph per test, so the loader's page-lifetime promise starts empty.
async function freshWrapper(): Promise<Wrapper> {
  vi.resetModules();
  return import('./sdg-header.js');
}

function headerElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('sdg-header');
  if (!element) throw new Error('no <sdg-header> rendered');
  return element;
}

describe('SdgHeader', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    document.head.replaceChildren();
    fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ src: '/shared-ui/header/v1/loader.js', integrity: INTEGRITY })),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the element with attributes for the props that are set', async () => {
    const { SdgHeader } = await freshWrapper();
    const { container } = render(<SdgHeader siteTitle="X" loginHref="/login" />);

    const element = headerElement(container);
    expect(element.getAttribute('site-title')).toBe('X');
    expect(element.getAttribute('login-href')).toBe('/login');
    expect(element.hasAttribute('user-name')).toBe(false);
    expect(element.hasAttribute('fluid')).toBe(false);
  });

  it('sets the boolean fluid attribute only when fluid is true', async () => {
    const { SdgHeader } = await freshWrapper();
    const { container, rerender } = render(<SdgHeader fluid />);
    expect(headerElement(container).getAttribute('fluid')).toBe('');

    rerender(<SdgHeader fluid={false} />);
    expect(headerElement(container).hasAttribute('fluid')).toBe(false);
  });

  it('renders children as light-DOM children of the element', async () => {
    const { SdgHeader } = await freshWrapper();
    const { container } = render(
      <SdgHeader siteTitle="X">
        <a slot="nav" href="/a" aria-current="page">
          A
        </a>
      </SdgHeader>,
    );

    const link = headerElement(container).querySelector('a[slot="nav"]');
    expect(link?.parentElement).toBe(headerElement(container));
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('calls onLogout once per sdg-logout, and not after unmount', async () => {
    const { SdgHeader } = await freshWrapper();
    const onLogout = vi.fn<(event: SdgLogoutEvent) => void>();
    const { container, unmount } = render(<SdgHeader userName="Ada" onLogout={onLogout} />);
    const element = headerElement(container);

    element.dispatchEvent(new CustomEvent('sdg-logout', { bubbles: true, composed: true }));
    expect(onLogout).toHaveBeenCalledOnce();

    unmount();
    element.dispatchEvent(new CustomEvent('sdg-logout', { bubbles: true, composed: true }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('passes sdg-settings to onSettings, which can cancel it', async () => {
    const { SdgHeader } = await freshWrapper();
    const onSettings = vi.fn<(event: SdgSettingsEvent) => void>((event) => event.preventDefault());
    const { container } = render(<SdgHeader userName="Ada" onSettings={onSettings} />);
    const element = headerElement(container);

    const settings = new CustomEvent('sdg-settings', { bubbles: true, composed: true, cancelable: true });
    element.dispatchEvent(settings);
    expect(onSettings).toHaveBeenCalledOnce();
    expect(settings.defaultPrevented).toBe(true);
  });

  it('passes the sdg-login event to onLogin, which can cancel it', async () => {
    const { SdgHeader } = await freshWrapper();
    const onLogin = vi.fn<(event: SdgLoginEvent) => void>((event) => event.preventDefault());
    const { container } = render(<SdgHeader loginHref="/login" onLogin={onLogin} />);

    const login = new CustomEvent('sdg-login', { bubbles: true, composed: true, cancelable: true });
    const notCancelled = headerElement(container).dispatchEvent(login);

    expect(onLogin).toHaveBeenCalledWith(login);
    expect(notCancelled).toBe(false);
  });

  it('injects one loader with its integrity across two wrappers in StrictMode', async () => {
    const { SdgHeader } = await freshWrapper();
    render(
      <StrictMode>
        <SdgHeader siteTitle="A" />
        <SdgHeader siteTitle="B" />
      </StrictMode>,
    );

    await vi.waitFor(() => expect(document.querySelectorAll('script')).toHaveLength(1));
    const [script] = Array.from(document.querySelectorAll('script'));
    expect(script?.getAttribute('src')).toBe('/shared-ui/header/v1/loader.js');
    expect(script?.getAttribute('integrity')).toBe(INTEGRITY);
    expect(script?.getAttribute('crossorigin')).toBe('anonymous');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/shared-ui/header/v1/loader.json', expect.anything());
  });

  it('reads the loader config from the configUrl prop when given', async () => {
    const { SdgHeader } = await freshWrapper();
    render(<SdgHeader configUrl="/elsewhere/loader.json" />);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/elsewhere/loader.json', expect.anything()));
  });
});
