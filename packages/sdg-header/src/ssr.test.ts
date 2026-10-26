// @vitest-environment node
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Next.js and other SSR frameworks import the package on the server, where there is no DOM.
describe('server rendering', () => {
  it('imports the React entry without a DOM and renders <sdg-header> as plain markup', async () => {
    expect(globalThis.customElements).toBeUndefined();
    const { SdgHeader } = await import('./react/index.js');
    const html = renderToString(
      createElement(SdgHeader, {
        headerTitle: 'My service',
        signInHref: '/login',
        navItems: [{ label: 'Help', href: '/help' }],
      }),
    );
    expect(html).toMatch(/^<sdg-header\b/u);
    expect(html).toContain('header-title="My service"');
    expect(html).toContain('sign-in-href="/login"');
    // Object and function props are client-only: React sets them as properties after hydration.
    expect(html).not.toContain('navItems');
  });
});
