// The package's JSX defaults to Preact (the element); the React files in this folder carry a
// `@jsxImportSource react` pragma, which both TypeScript and Vite honour per file.
export type { HeaderAttributeName, HeaderEventName } from '../contract.js';
export {
  HEADER_ATTRIBUTES,
  HEADER_EVENTS,
  HEADER_MAJOR,
  HEADER_TAG,
  RETURN_TO_PARAM,
  withReturnTo,
} from '../contract.js';
export type { SdgHeaderAttributes, SdgLoginEvent, SdgLogoutEvent, SdgSettingsEvent } from '../types.js';
export type { SdgHeaderIntrinsicProps } from './jsx.js';
export { DEFAULT_LOADER_CONFIG_URL, loadSdgHeader } from './load-script.js';
export { SdgHeader, type SdgHeaderProps } from './sdg-header.js';
