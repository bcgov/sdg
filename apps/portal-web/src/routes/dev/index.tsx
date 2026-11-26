import { Heading } from '@repo/design-system/components/heading';
import { createFileRoute } from '@tanstack/react-router';
import type { JSX } from 'react';

import { DevPageLayout } from '../../components/dev/dev-page-layout';
import { DEV_PAGES, type DevPage } from '../../components/dev/dev-pages';
import { DevSection } from '../../components/dev/dev-section';
import { Link } from '../../components/link';

// Local development helpers, not linked from the app: pages for checking design-system components. Start at /dev.
export const Route = createFileRoute('/dev/')({
  component: DevIndexPage,
});

const groups = [
  {
    id: 'extended',
    title: 'Extended components',
    description: 'BCDS components with behaviour added here.',
    pages: DEV_PAGES.filter((page) => page.kind === 'extended'),
  },
  {
    id: 'custom',
    title: 'Custom components',
    description: "Components BCDS doesn't have.",
    pages: DEV_PAGES.filter((page) => page.kind === 'custom'),
  },
] as const;

const sections = [
  { id: 'how-we-build', title: 'How we build components' },
  ...groups.map(({ id, title }) => ({ id, title })),
];

function HowWeBuild(): JSX.Element {
  return (
    <DevSection id="how-we-build" title="How we build components">
      <p>
        We use BCDS components as they ship wherever we can. When one nearly fits, we extend it; when BCDS has nothing
        suitable, we build a new one. Both live in <code>@repo/design-system</code>, and the full rules are in{' '}
        <code>packages/design-system/README.md</code>.
      </p>

      <Heading level={3}>Extending a BCDS component</Heading>
      <p>
        An extended component wraps the BCDS one under the same name and adds only what's missing, such as the{' '}
        <code>warning</code> variant on Button. Every other prop passes straight through, so it behaves like the
        original. We never edit or patch the BCDS package itself.
      </p>

      <Heading level={3}>Building a new component</Heading>
      <p>
        A new component is for something neither BCDS nor React Aria provides, such as Card or Avatar. It's built from
        BCDS and React Aria pieces where it can be, and never imports the app or its router: links and other app
        elements come in as props.
      </p>

      <Heading level={3}>Built so BCDS could adopt them</Heading>
      <p>Both kinds follow BCDS's own style, so BCDS could take them into the design system if it chose to:</p>
      <ul>
        <li>
          Styles use BC design tokens, the CSS variables such as <code>--surface-color-border-default</code> and{' '}
          <code>--layout-padding-medium</code>, never hard-coded colours or sizes.
        </li>
        <li>
          Props reuse BCDS names and patterns: named slots like <code>title</code>, <code>description</code> and{' '}
          <code>buttons</code>, and <code>titleElement</code>, <code>size</code> and <code>variant</code>.
        </li>
        <li>
          Hover, focus and pressed states use React Aria's data attributes (<code>[data-hovered]</code>,{' '}
          <code>[data-focus-visible]</code>), as BCDS components do.
        </li>
        <li>Markup is semantic and labelled, with visible keyboard focus.</li>
      </ul>
    </DevSection>
  );
}

function PageList({ pages }: Readonly<{ pages: readonly DevPage[] }>): JSX.Element {
  return (
    <ul>
      {pages.map((page) => (
        <li key={page.to}>
          <Link to={page.to}>{page.title}</Link>
          {page.status === 'placeholder' && ' (placeholder)'}: {page.description}
        </li>
      ))}
    </ul>
  );
}

function DevIndexPage(): JSX.Element {
  return (
    <DevPageLayout
      title="Dev helpers"
      description="A page for each design-system component that isn't used as BCDS ships it. BCDS components used as designed are documented by BCDS."
      sections={sections}
    >
      <HowWeBuild />
      {groups.map(({ id, title, description, pages }) => (
        <DevSection key={id} id={id} title={title} description={description}>
          <PageList pages={pages} />
        </DevSection>
      ))}
    </DevPageLayout>
  );
}
