import { faKey, FontAwesomeIcon } from '@repo/design-system/icons';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// oxlint-disable-next-line import/default -- Vite's `?raw` query makes the file's text the default export.
import mainSource from './main.tsx?raw';

// FontAwesome prepends a <style> the first time an icon renders unless `config.autoAddCss` is off; the edge CSP has no
// hash for it, so console-web turns it off and loads FontAwesome's stylesheet instead (font-awesome.ts). test-setup.ts
// runs the same setup, so these tests see the document head production does.
describe('icons under the edge CSP', () => {
  it('renders a FontAwesome icon without adding a <style> to the document head', () => {
    const before = document.head.querySelectorAll('style').length;
    const { container } = render(<FontAwesomeIcon icon={faKey} />);
    expect(container.querySelector('svg')).toHaveClass('svg-inline--fa');
    expect(document.head.querySelectorAll('style')).toHaveLength(before);
  });

  // The test above runs under test-setup.ts; this ties it to the production entry point, which must run the same setup.
  it('runs the FontAwesome setup in the production entry point', () => {
    expect(mainSource).toMatch(/^import \{ setUpFontAwesome \} from '\.\/font-awesome';$/m);
    expect(mainSource).toMatch(/^setUpFontAwesome\(\);$/m);
  });
});
