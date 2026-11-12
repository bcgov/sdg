import '@fortawesome/fontawesome-svg-core/styles.css';
import { config } from '@fortawesome/fontawesome-svg-core';

/**
 * FontAwesome would prepend a <style> on the first icon render, which the edge CSP blocks (it has no hash for it); its
 * stylesheet is imported above instead. Run once before anything renders: main.tsx, and test-setup.ts for the tests.
 */
export function setUpFontAwesome(): void {
  config.autoAddCss = false;
}
