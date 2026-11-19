/** The SDG account settings page, which the user menu's Account Settings item links to on every site. */
export const SETTINGS_PATH = '/account-settings';

/**
 * SDG's origin, read once while this module first evaluates. In the CDN bundle that happens during the classic
 * script's own run, when `document.currentScript` is the header's `<script>`: each environment (PR, test, prod) serves
 * the script from its own SDG host, and partner sites load it from there, so the header links back to the SDG that
 * served it with no configuration. The module build (in-repo apps and tests) has no current script; it is only used
 * on SDG's own pages, so it falls back to the page's origin.
 */
function sdgOrigin(): string {
  if (typeof document === 'undefined') return '';
  const script = document.currentScript;
  if (script instanceof HTMLScriptElement && script.src) return new URL(script.src).origin;
  return window.location.origin;
}

export const SETTINGS_HREF: string = `${sdgOrigin()}${SETTINGS_PATH}`;
