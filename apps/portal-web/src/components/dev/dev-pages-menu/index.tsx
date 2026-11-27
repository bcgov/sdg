import { Button } from '@repo/design-system/components/button';
import { Menu, MenuItem, MenuTrigger, type MenuProps } from '@repo/design-system/components/menu';
import { FontAwesomeIcon, faChevronDown } from '@repo/design-system/icons';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, type JSX } from 'react';

import { DEV_PAGES, type DevPagePath } from '../dev-pages';

/** react-aria's item key, from the menu's own props so this app needn't import react-aria. */
type Key = Parameters<NonNullable<MenuProps['onAction']>>[0];

const overview = '/dev';

/** Alphabetical by title, whatever order `DEV_PAGES` is in. */
const menuPages = DEV_PAGES.toSorted((a, b) => a.title.localeCompare(b.title));

function isDevPath(key: Key): key is DevPagePath | typeof overview {
  return key === overview || DEV_PAGES.some((page) => page.to === key);
}

/** A menu of every dev page, for moving between them without going back to the index. */
export function DevPagesMenu(): JSX.Element {
  const navigate = useNavigate();
  const open = useCallback(
    (key: Key) => {
      if (isDevPath(key)) void navigate({ to: key });
    },
    [navigate],
  );

  return (
    <MenuTrigger>
      <Button variant="secondary" size="small">
        Dev pages
        <FontAwesomeIcon icon={faChevronDown} />
      </Button>
      <Menu aria-label="Dev pages" placement="bottom end" onAction={open}>
        <MenuItem id={overview} label="All dev pages" />
        {menuPages.map((page) => (
          <MenuItem key={page.to} id={page.to} label={page.title} />
        ))}
      </Menu>
    </MenuTrigger>
  );
}
