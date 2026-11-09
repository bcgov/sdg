import type { Plugin } from 'vite';

/** The module whose runtime CSS injection this plugin rewrites (its package exports only this ESM entry). */
export const BCGOV_MODULE = '@bcgov/design-system-react-components/dist/esm/index.js';

// rollup-plugin-postcss's styleInject: appends one <style> per stylesheet to <head>, which a CSP without
// 'unsafe-inline' in style-src blocks. Matched whole (up to its closing brace at column 0) so any upstream
// change to it fails the build instead of silently shipping <style> injection the edge CSP would block.
const STYLE_INJECT = /^function styleInject\(css, ref\) \{\n[\s\S]*?\n\}$/m;

// Constructable stylesheets aren't governed by style-src. Adopted sheets cascade after the document's own, where
// the appended <style> elements were, and keep their order.
const ADOPT = `function styleInject(css) {
  if (!css || typeof document === 'undefined') { return; }
  var sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}`;

/**
 * Returns the bcgov design system module with styleInject rewritten, or undefined for any other module.
 * Throws when the module no longer has the expected styleInject.
 */
export function rewriteStyleInject(code: string, id: string): string | undefined {
  if (!id.replaceAll('\\', '/').endsWith(BCGOV_MODULE)) return undefined;
  if (!STYLE_INJECT.test(code)) {
    throw new Error(
      `${BCGOV_MODULE} no longer defines styleInject(css, ref) as expected; update ` +
        '@repo/vite-config adopted-style-sheets.ts so its CSS still loads under the edge CSP.',
    );
  }
  return code.replace(STYLE_INJECT, ADOPT);
}

/**
 * Makes the bcgov design system's CSS work under a strict style-src: its `<style>` injection becomes
 * `document.adoptedStyleSheets`. Build only: the dev server pre-bundles dependencies and injects its own
 * `<style>` elements, so dev keeps `'unsafe-inline'` styles.
 */
export function adoptedStyleSheets(): Plugin {
  return {
    name: 'sdg:adopted-style-sheets',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      const rewritten = rewriteStyleInject(code, id);
      return rewritten === undefined ? undefined : { code: rewritten, map: null };
    },
  };
}
