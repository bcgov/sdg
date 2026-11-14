import { Dialog } from '@repo/design-system/components/dialog';
import { Heading } from '@repo/design-system/components/heading';
import { Modal } from '@repo/design-system/components/modal';
import { type ReactNode, useCallback, useId } from 'react';

import styles from './feature-flags.module.css';

interface FormDialogProps {
  title: string;
  isOpen: boolean;
  /** While a save is in flight, Escape and a press outside don't close the dialog. */
  isPending: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal dialog around a form (create, edit). react-aria's modal traps focus inside it, closes on Escape or its Close
 * button and returns focus to the button that opened it.
 */
export function FormDialog({ title, isOpen, isPending, onClose, children }: Readonly<FormDialogProps>) {
  const titleId = useId();
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!isPending} isKeyboardDismissDisabled={isPending}>
      <Dialog aria-labelledby={titleId}>
        <div className={styles.dialogBody}>
          <Heading level={2} id={titleId}>
            {title}
          </Heading>
          {children}
        </div>
      </Dialog>
    </Modal>
  );
}
