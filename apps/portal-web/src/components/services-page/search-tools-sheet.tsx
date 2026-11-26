import { Button } from '@repo/design-system/components/button';
import { Dialog } from '@repo/design-system/components/dialog';
import { Modal } from '@repo/design-system/components/modal';
import { faXmark, FontAwesomeIcon } from '@repo/design-system/icons';
import { useCallback, useId } from 'react';

import { DEFAULT_SERVICE_TYPE, TypeFilter, type ServiceType } from './type-filter';

import styles from './search-tools.module.css';

const CLOSE_ICON = <FontAwesomeIcon icon={faXmark} aria-hidden="true" />;

interface SearchToolsSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  type: ServiceType;
  onTypeChange: (type: ServiceType) => void;
}

/**
 * Search tools as a modal sheet on medium screens (from the right, Figma 36:68956) and small ones (from the bottom,
 * Figma 37:71668). A filter applies as soon as it's selected, so Show results only closes the sheet; Clear all resets
 * the filter, and clicking the dimmed area outside the sheet closes it. The results are placeholders for now, so nothing
 * visibly changes yet.
 */
export function SearchToolsSheet({ isOpen, onOpenChange, type, onTypeChange }: Readonly<SearchToolsSheetProps>) {
  const headingId = useId();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const clear = useCallback(() => onTypeChange(DEFAULT_SERVICE_TYPE), [onTypeChange]);
  return (
    <Modal className={styles['sheetModal']} isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
      <Dialog className={styles['sheet']} isCloseable={false} aria-labelledby={headingId}>
        <div className={styles['sheetHeader']}>
          <h2 id={headingId} className={styles['title']}>
            Search tools
          </h2>
          <Button variant="tertiary" isIconButton aria-label="Close search tools" onPress={close}>
            {CLOSE_ICON}
          </Button>
        </div>
        <div className={styles['sheetBody']}>
          <TypeFilter value={type} onChange={onTypeChange} />
        </div>
        <div className={styles['sheetFooter']}>
          <Button variant="secondary" onPress={clear}>
            Clear all
          </Button>
          <Button variant="primary" onPress={close}>
            Show results
          </Button>
        </div>
      </Dialog>
    </Modal>
  );
}
