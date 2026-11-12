import { Avatar } from '@repo/design-system/components/avatar';
import { Button } from '@repo/design-system/components/button';
import { Menu, MenuItem, MenuSection, MenuSectionHeader, MenuTrigger } from '@repo/design-system/components/menu';
import { Separator } from '@repo/design-system/components/separator';
import { faArrowRightFromBracket, faGear, FontAwesomeIcon } from '@repo/design-system/icons';
import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import type { CurrentUser } from '../../auth/api';
import { useCurrentUser } from '../../auth/use-current-user';
import { useSignOut } from '../../auth/use-sign-out';
import { useSidebar } from './sidebar-context';
import { RailTooltip } from './sidebar-nav';

import styles from './account-menu.module.css';

type Size = 'small' | 'medium';

const SETTINGS_ICON = <FontAwesomeIcon icon={faGear} />;
const LOG_OUT_ICON = <FontAwesomeIcon icon={faArrowRightFromBracket} />;

/** Avatar, name and email (when there is one), as in the trigger and the menu's profile block. */
function Identity({ user, size }: Readonly<{ user: CurrentUser; size: Size }>) {
  return (
    <span className={styles.identity}>
      <Avatar name={user.name} size={size} decorative />
      <span className={styles.text}>
        <span className={styles.name}>{user.name}</span>
        {user.email ? <span className={styles.email}>{user.email}</span> : null}
      </span>
    </span>
  );
}

function AccountButton({ user, label }: Readonly<{ user: CurrentUser; label: string }>) {
  const { expanded } = useSidebar();
  return (
    <RailTooltip label={user.name}>
      <Button variant="tertiary" aria-label={label}>
        {expanded ? <Identity user={user} size="small" /> : <Avatar name={user.name} size="small" decorative />}
      </Button>
    </RailTooltip>
  );
}

/**
 * The account button at the foot of the sidebar and its menu (R11): the profile block, Settings and Log out, as in
 * `<sdg-header>`'s account menu. Items navigate with `onAction` (KTD8): a bcgov MenuItem `href` would reload the page.
 */
export function AccountMenu() {
  const { data: user } = useCurrentUser();
  const router = useRouter();
  const signOut = useSignOut();
  const openProfile = useCallback(() => void router.navigate({ to: '/profile' }), [router]);
  // The `_app` guard has loaded the user before the shell renders; there is nothing to show without one.
  if (!user) return null;
  const label = `Account menu for ${user.name}`;
  return (
    <div className={styles.account}>
      <MenuTrigger>
        <AccountButton user={user} label={label} />
        <Menu placement="right bottom">
          <MenuSection>
            <MenuSectionHeader className={styles.profile}>
              <Identity user={user} size="medium" />
            </MenuSectionHeader>
          </MenuSection>
          <Separator size="small" />
          <MenuItem textValue="Settings" onAction={openProfile} iconLeft={SETTINGS_ICON}>
            Settings
          </MenuItem>
          <Separator size="small" />
          <MenuItem textValue="Log out" onAction={signOut} iconLeft={LOG_OUT_ICON}>
            Log out
          </MenuItem>
        </Menu>
      </MenuTrigger>
    </div>
  );
}
