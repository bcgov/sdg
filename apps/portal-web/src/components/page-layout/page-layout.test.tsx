import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageLayout } from '.';

// fileURLToPath on the string: jsdom replaces the global URL class.
const stylesheet = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page-layout.module.css'), 'utf8');

describe('PageLayout', () => {
  it('groups the h1 and a rule in a header, then renders the content', () => {
    const { container } = render(
      <PageLayout title="Help">
        <p>Body</p>
      </PageLayout>,
    );
    const page = container.firstElementChild;
    const header = page?.children[0];
    expect(header?.className).toMatch(/header/);
    expect(screen.getByRole('heading', { level: 1, name: 'Help' })).toBe(header?.children[0]);
    expect(screen.getByRole('separator')).toBe(header?.children[1]);
    expect(page?.children[1]?.textContent).toBe('Body');
  });

  it('spaces the title and rule 8px apart with the header gap, and adds no rule margins', () => {
    const header = /\n\.header \{(?<body>[^}]*)\}/u.exec(stylesheet)?.groups?.['body'];
    expect(header).toContain('gap: var(--layout-margin-small);');
    expect(stylesheet).not.toMatch(/\.rule/u);
  });

  it('renders a subtitle between the title and the rule when given', () => {
    render(<PageLayout title="Oops" subtitle="Error 404 - Page not found" />);
    const subtitle = screen.getByText('Error 404 - Page not found');
    expect(subtitle.tagName).toBe('P');
    expect(subtitle.previousElementSibling).toBe(screen.getByRole('heading', { level: 1, name: 'Oops' }));
    expect(subtitle.nextElementSibling).toBe(screen.getByRole('separator'));
  });

  it('renders no subtitle when none is given', () => {
    render(<PageLayout title="Help" />);
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling).toBe(screen.getByRole('separator'));
  });

  it('sets the title in 28px bold', () => {
    expect(stylesheet).toMatch(/\.header > \.title \{[^}]*700 1\.75rem\/2\.625rem/u);
  });
});
