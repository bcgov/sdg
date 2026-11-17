// The package's JSX defaults to Preact (the element); the React files in this folder carry a
// `@jsxImportSource react` pragma, which both TypeScript and Vite honour per file.
export type { HeaderAttributeName, HeaderEventName } from '../contract.js';
export { HEADER_ATTRIBUTES, HEADER_EVENTS, HEADER_MAJOR, HEADER_TAG } from '../contract.js';
export type { SdgHeaderAttributes, SdgLoginEvent, SdgLogoutEvent } from '../types.js';
export type { SdgHeaderIntrinsicProps } from './jsx.js';
export { DEFAULT_HEADER_SRC, loadSdgHeader } from './load-script.js';
export { SdgHeader, type SdgHeaderProps } from './sdg-header.js';
