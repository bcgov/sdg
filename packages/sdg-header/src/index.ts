import { defineSdgHeader } from './define.js';
import type { SdgHeader } from './sdg-header.js';

export { defineSdgHeader };
export { SdgHeader } from './sdg-header.js';
export type { HeaderUser, NavItem, SkipLink } from './types.js';

declare global {
  interface HTMLElementTagNameMap {
    'sdg-header': SdgHeader;
  }
}

defineSdgHeader();
