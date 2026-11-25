import type { RegisteredRouter } from '@tanstack/react-router';

/** Every route path under `/dev/` but the index, so a page entry can't point at a route that doesn't exist. */
export type DevPagePath = Exclude<Extract<keyof RegisteredRouter['routesByPath'], `/dev/${string}`>, '/dev/'>;

export interface DevPage {
  to: DevPagePath;
  title: string;
  /** `extended` wraps a BCDS component with added behaviour; `custom` isn't in BCDS at all. */
  kind: 'extended' | 'custom';
  status: 'ready' | 'placeholder';
  /** One line on what the component is, shown on its page and the /dev index. */
  description: string;
  /** The design-system subpath the component is imported from. */
  importPath: `@repo/design-system/components/${string}`;
  /** The names to import, as written in the usage snippet. */
  importNames: string;
}

/**
 * The /dev pages, one per design-system component that isn't used as BCDS ships it. The index page, the pages menu
 * and the route tests all read this list: add an entry here when adding a page.
 */
export const DEV_PAGES: readonly DevPage[] = [
  {
    to: '/dev/button',
    title: 'Button',
    kind: 'extended',
    status: 'ready',
    description: 'The BCDS button with an added warning variant. (As an example)',
    importPath: '@repo/design-system/components/button',
    importNames: 'Button',
  },
  {
    to: '/dev/avatar',
    title: 'Avatar',
    kind: 'custom',
    status: 'placeholder',
    description: "A person's photo, or their initials when there's no photo.",
    importPath: '@repo/design-system/components/avatar',
    importNames: 'Avatar, getInitials',
  },
  {
    to: '/dev/card',
    title: 'Card',
    kind: 'custom',
    status: 'placeholder',
    description: 'A bordered container for a titled item, optionally linked.',
    importPath: '@repo/design-system/components/card',
    importNames: 'Card',
  },
  {
    to: '/dev/data-table',
    title: 'Data table',
    kind: 'custom',
    status: 'placeholder',
    description: 'A sortable, paged table whose sort and page live in the URL.',
    importPath: '@repo/design-system/components/data-table',
    importNames: 'DataTable, dataTableColumnHelper',
  },
  {
    to: '/dev/details',
    title: 'Details',
    kind: 'custom',
    status: 'placeholder',
    description: 'A description list laid out as label, value and extra columns.',
    importPath: '@repo/design-system/components/details',
    importNames: 'Details',
  },
  {
    to: '/dev/nav-link',
    title: 'Nav link',
    kind: 'custom',
    status: 'placeholder',
    description: 'A navigation item: plain text that underlines on hover.',
    importPath: '@repo/design-system/components/nav-link',
    importNames: 'NavLink',
  },
  {
    to: '/dev/section',
    title: 'Section',
    kind: 'custom',
    status: 'placeholder',
    description: 'A page section with an optional title and description above its content.',
    importPath: '@repo/design-system/components/section',
    importNames: 'Section',
  },
  {
    to: '/dev/tabs',
    title: 'Tabs',
    kind: 'custom',
    status: 'placeholder',
    description: 'A row of tabs, each switching to its own panel.',
    importPath: '@repo/design-system/components/tabs',
    importNames: 'Tab, TabList, TabPanel, Tabs',
  },
];

/** The entry for a path. Every dev route has one, so a missing entry is a mistake that should fail loudly. */
export function devPage(to: DevPagePath): DevPage {
  const page = DEV_PAGES.find((p) => p.to === to);
  if (!page) throw new Error(`No DEV_PAGES entry for ${to}`);
  return page;
}

/** The usage snippet for a page's import line. */
export function importCode(page: DevPage): string {
  return `import { ${page.importNames} } from '${page.importPath}';`;
}
