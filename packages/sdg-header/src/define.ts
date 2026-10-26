import { SdgHeader } from './sdg-header.js';

/**
 * Registers `<sdg-header>` unless the name is already taken, so the npm, React and CDN builds (or two copies of any)
 * can load on one page. Each entry calls it at the top level: an explicit call can't be tree-shaken away the way a
 * bare side-effect import can.
 */
export function defineSdgHeader(): void {
  if (!customElements.get('sdg-header')) customElements.define('sdg-header', SdgHeader);
}
