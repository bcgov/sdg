import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card } from './card';

afterEach(cleanup);

// Card supplies the link text (the title) when it clones the link element.
function PermitLink({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a href="/permits/new" {...props}>
      {children}
    </a>
  );
}

const saveButton = <button type="button">Save</button>;
const icon = <svg data-testid="icon" />;
const permitLink = <PermitLink className="own" />;

describe('Card', () => {
  it('renders an article named by its h3 title', () => {
    render(<Card title="Apply for a permit" />);
    const card = screen.getByRole('article', { name: 'Apply for a permit' });
    expect(card).toBeDefined();
    expect(screen.getByRole('heading', { level: 3, name: 'Apply for a permit' })).toBeDefined();
  });

  it('uses titleElement for the heading level', () => {
    render(<Card title="Permits" titleElement="h2" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Permits' })).toBeDefined();
  });

  it('renders description, body and buttons only when given', () => {
    const { rerender } = render(<Card title="Permits" />);
    const card = screen.getByRole('article');
    expect(card.querySelector('p')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <Card title="Permits" description="Short summary." buttons={saveButton}>
        <span>Body text</span>
      </Card>,
    );
    expect(screen.getByText('Short summary.').tagName).toBe('P');
    expect(screen.getByText('Body text')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('hides the icon from assistive technology', () => {
    render(<Card title="Permits" icon={icon} />);
    expect(screen.getByTestId('icon').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('wraps the title in the link element and keeps buttons separate', () => {
    render(<Card title="Apply for a permit" linkElement={permitLink} buttons={saveButton} />);
    const link = screen.getByRole('link', { name: 'Apply for a permit' });
    expect(link.getAttribute('href')).toBe('/permits/new');
    expect(link.classList).toContain('own');
    expect(link.className).toMatch(/titleLink/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('has no link without a link element', () => {
    render(<Card title="Permits" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('passes className and other props to the root', () => {
    render(<Card title="Permits" className="extra" data-testid="card" />);
    const card = screen.getByRole('article');
    expect(card.classList).toContain('extra');
    expect(card.className).toMatch(/card/);
    expect(card.getAttribute('data-testid')).toBe('card');
  });

  it('applies the layout class from column and centered, with column winning', () => {
    const { rerender } = render(<Card title="Permits" />);
    const card = screen.getByRole('article');
    expect(card.className).not.toMatch(/column|centered/);
    rerender(<Card title="Permits" centered />);
    expect(card.className).toMatch(/centered/);
    rerender(<Card title="Permits" column />);
    expect(card.className).toMatch(/column/);
    // @ts-expect-error -- centered can't be combined with column.
    rerender(<Card title="Permits" column centered />);
    expect(card.className).toMatch(/column/);
    expect(card.className).not.toMatch(/centered/);
  });
});
