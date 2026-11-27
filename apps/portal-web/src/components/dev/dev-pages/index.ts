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

/** The slug after `/dev/`, which is also the component's design-system subpath. */
type DevPageSlug = DevPagePath extends `/dev/${infer Slug}` ? Slug : never;

const COMPONENTS_PATH = '@repo/design-system/components';

/** A custom component whose page is still a placeholder: its route and import path both come from `slug`. */
function placeholder(slug: DevPageSlug, title: string, description: string, importNames: string): DevPage {
  return {
    to: `/dev/${slug}`,
    title,
    kind: 'custom',
    status: 'placeholder',
    description,
    importPath: `${COMPONENTS_PATH}/${slug}`,
    importNames,
  };
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
    importPath: `${COMPONENTS_PATH}/button`,
    importNames: 'Button',
  },
  placeholder('avatar', 'Avatar', "A person's photo, or their initials when there's no photo.", 'Avatar, getInitials'),
  placeholder('card', 'Card', 'A bordered container for a titled item, optionally linked.', 'Card'),
  placeholder(
    'data-table',
    'Data table',
    'A sortable, paged table whose sort and page live in the URL.',
    'DataTable, dataTableColumnHelper',
  ),
  placeholder('details', 'Details', 'A description list laid out as label, value and extra columns.', 'Details'),
  placeholder('nav-link', 'Nav link', 'A navigation item: plain text that underlines on hover.', 'NavLink'),
  placeholder(
    'section',
    'Section',
    'A page section with an optional title and description above its content.',
    'Section',
  ),
  {
    to: '/dev/text-field',
    title: 'Text field',
    kind: 'extended',
    status: 'placeholder',
    description: 'The BCDS text field with added xsmall and large sizes.',
    importPath: `${COMPONENTS_PATH}/text-field`,
    importNames: 'TextField',
  },
  placeholder('tabs', 'Tabs', 'A row of tabs, each switching to its own panel.', 'Tab, TabList, TabPanel, Tabs'),
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
