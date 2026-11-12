import { FontAwesomeIcon } from '@repo/design-system/icons';
import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
// The direct react-aria copy, not bcgov's bundled one: bcgov has no Autocomplete or SearchField, and its Menu always
// sits in a Popover (KTD2). Every piece of the palette comes from this copy, so no context has to cross copies.
import {
  Autocomplete,
  Dialog,
  Input,
  type Key,
  Menu,
  MenuItem,
  Modal,
  ModalOverlay,
  SearchField,
  useFilter,
} from 'react-aria-components';

import { MAIN_NAV, type NavItem, SECONDARY_NAV } from './nav-items';

import styles from './command-palette.module.css';

/** Search covers navigation only: the four sidebar destinations (R14). */
const DESTINATIONS: readonly NavItem[] = [...MAIN_NAV, ...SECONDARY_NAV];

const renderNoResults = () => <p className={styles.empty}>No results</p>;

interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * The command palette (R8, R14): a modal search that filters the destinations as the administrator types and goes
 * to the chosen one with `router.navigate` (KTD8). Escape closes it, and the modal returns focus to where it was.
 */
export function CommandPalette({ isOpen, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { contains } = useFilter({ sensitivity: 'base' });
  const go = useCallback(
    (key: Key) => {
      const destination = DESTINATIONS.find((item) => item.to === key);
      if (!destination) return;
      onOpenChange(false);
      void router.navigate({ to: destination.to });
    },
    [onOpenChange, router],
  );
  return (
    <ModalOverlay className={styles.overlay} isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog} aria-label="Search">
          <Autocomplete filter={contains}>
            {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- a search dialog opens onto its field (R14); the modal returns focus on close. */}
            <SearchField className={styles.field} aria-label="Search" autoFocus>
              <Input className={styles.input} placeholder="Search…" />
            </SearchField>
            <Menu className={styles.list} items={DESTINATIONS} onAction={go} renderEmptyState={renderNoResults}>
              {(item) => (
                <MenuItem className={styles.item} id={item.to} textValue={item.label}>
                  <FontAwesomeIcon icon={item.icon} className={styles.icon} />
                  {item.label}
                </MenuItem>
              )}
            </Menu>
          </Autocomplete>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
