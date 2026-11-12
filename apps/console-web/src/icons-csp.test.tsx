import { faKey, FontAwesomeIcon } from '@repo/design-system/icons';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// FontAwesome prepends a <style> the first time an icon renders unless `config.autoAddCss` is off; the edge CSP has no
// hash for it, so console-web turns it off and loads FontAwesome's stylesheet instead (main.tsx, test-setup.ts).
describe('icons under the edge CSP', () => {
  it('renders a FontAwesome icon without adding a <style> to the document head', () => {
    const before = document.head.querySelectorAll('style').length;
    const { container } = render(<FontAwesomeIcon icon={faKey} />);
    expect(container.querySelector('svg')).toHaveClass('svg-inline--fa');
    expect(document.head.querySelectorAll('style')).toHaveLength(before);
  });
});
