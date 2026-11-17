/** @jsxImportSource react */
import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdgLoginEvent, SdgLogoutEvent } from '../types.js';

type Wrapper = typeof import('./sdg-header.js');

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
  beforeEach(() => {
    document.head.replaceChildren();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the element with attributes for the props that are set', async () => {
    const { SdgHeader } = await freshWrapper();
    const { container } = render(<SdgHeader siteTitle="X" loginHref="/login" />);

    const element = headerElement(container);
    expect(element.getAttribute('site-title')).toBe('X');
    expect(element.getAttribute('login-href')).toBe('/login');
    expect(element.hasAttribute('user-name')).toBe(false);
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

  it('passes the sdg-login event to onLogin, which can cancel it', async () => {
    const { SdgHeader } = await freshWrapper();
    const onLogin = vi.fn<(event: SdgLoginEvent) => void>((event) => event.preventDefault());
    const { container } = render(<SdgHeader loginHref="/login" onLogin={onLogin} />);

    const login = new CustomEvent('sdg-login', { bubbles: true, composed: true, cancelable: true });
    const notCancelled = headerElement(container).dispatchEvent(login);

    expect(onLogin).toHaveBeenCalledWith(login);
    expect(notCancelled).toBe(false);
  });

  it('injects the default script once across two wrappers in StrictMode', async () => {
    const { SdgHeader } = await freshWrapper();
    render(
      <StrictMode>
        <SdgHeader siteTitle="A" />
        <SdgHeader siteTitle="B" />
      </StrictMode>,
    );

    const scripts = Array.from(document.querySelectorAll('script'));
    expect(scripts.map((script) => script.getAttribute('src'))).toEqual(['/shared-ui/header/v1/sdg-header.js']);
  });

  it('loads the script from the src prop when given', async () => {
    const { SdgHeader } = await freshWrapper();
    render(<SdgHeader src="https://portal.example/shared-ui/header/v1/sdg-header.js" />);

    const scripts = Array.from(document.querySelectorAll('script'));
    expect(scripts.map((script) => script.src)).toEqual(['https://portal.example/shared-ui/header/v1/sdg-header.js']);
  });
});
