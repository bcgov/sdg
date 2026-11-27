// Types for the <sdg-header> element's attributes and events (R13), shared by the React wrapper and by TypeScript
// hosts that use the element directly. Types only: importing this file adds no runtime code.

/** The element's attributes. All are optional: with neither `user-name` nor `login-href` the auth control is empty. */
export interface SdgHeaderAttributes {
  /** The site title shown after the logo. */
  'site-title'?: string;
  /** The signed-in user's name. When set, the header shows a user menu (Settings, Log Out) instead of Log In. */
  'user-name'?: string;
  /** Where Log In links to. Shown only when `user-name` is not set. */
  'login-href'?: string;
  /** Boolean: present (any value) makes the rows' contents full width instead of the responsive max-width container. */
  fluid?: boolean | '';
}

/** `sdg-login`: cancelable; `preventDefault()` stops the Log In link from navigating. */
export type SdgLoginEvent = CustomEvent<null>;

/** `sdg-logout`: the host must sign the visitor out (for example, with a POST); the header does nothing else. */
export type SdgLogoutEvent = CustomEvent<null>;

/** `sdg-settings`: cancelable; `preventDefault()` stops the Settings link (SDG's `/settings`) from navigating. */
export type SdgSettingsEvent = CustomEvent<null>;

/** `sdg-home`: cancelable; `preventDefault()` stops the logo's link (SDG's home page) from navigating. */
export type SdgHomeEvent = CustomEvent<null>;

declare global {
  interface HTMLElementEventMap {
    'sdg-login': SdgLoginEvent;
    'sdg-logout': SdgLogoutEvent;
    'sdg-settings': SdgSettingsEvent;
    'sdg-home': SdgHomeEvent;
  }
}
