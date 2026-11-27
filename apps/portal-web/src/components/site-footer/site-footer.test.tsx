import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SiteFooter } from '.';

describe('SiteFooter', () => {
  it('lists Disclaimer, Privacy, Accessibility and Copyright, each opening its gov.bc.ca page in a new tab', () => {
    render(<SiteFooter />);
    const footer = screen.getByRole('contentinfo');
    const links = within(footer)
      .getAllByRole('link')
      .filter((link) => link.closest('.bcds-footer--links'));
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Disclaimer', 'https://www2.gov.bc.ca/gov/content/home/disclaimer'],
      ['Privacy', 'https://www2.gov.bc.ca/gov/content/home/privacy'],
      ['Accessibility', 'https://www2.gov.bc.ca/gov/content/home/accessible-government'],
      ['Copyright', 'https://www2.gov.bc.ca/gov/content/home/copyright'],
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAccessibleName(`${link.textContent} (opens in a new tab)`);
    }
  });
});
