import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SupplementaryBlock } from '.';

describe('SupplementaryBlock', () => {
  it('renders a region named by its h2 title, then the description and content', () => {
    render(
      <SupplementaryBlock title="Find more services" tone="light" spacing="large" description="Intro.">
        <p>Body</p>
      </SupplementaryBlock>,
    );
    const region = screen.getByRole('region', { name: 'Find more services' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Find more services' });
    expect(heading.className).toMatch(/light/);
    const body = heading.nextElementSibling;
    expect(body?.className).toMatch(/padding-large/);
    expect(body?.className).toMatch(/gap-large/);
    expect(heading.className).toMatch(/inset-medium/);
    expect([...body!.children].map((child) => child.textContent)).toEqual(['Intro.', 'Body']);
    expect(body?.parentElement).toBe(region);
  });

  it('omits the description paragraph when there is none, and applies the dark tone and medium spacing', () => {
    render(
      <SupplementaryBlock title="Contact information" tone="dark" spacing="medium">
        <p>Body</p>
      </SupplementaryBlock>,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.className).toMatch(/dark/);
    expect(heading.nextElementSibling?.className).toMatch(/padding-medium/);
    expect(heading.nextElementSibling?.children).toHaveLength(1);
  });

  it('takes a separate gap and a large heading inset', () => {
    render(
      <SupplementaryBlock title="Still looking?" tone="light" spacing="large" gap="medium" headingInset="large">
        <p>Body</p>
      </SupplementaryBlock>,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.className).toMatch(/inset-large/);
    expect(heading.nextElementSibling?.className).toMatch(/padding-large/);
    expect(heading.nextElementSibling?.className).toMatch(/gap-medium/);
  });
});
