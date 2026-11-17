import { AlertDialog } from '@repo/design-system/components/alert-dialog';
import { Button } from '@repo/design-system/components/button';
import { Modal } from '@repo/design-system/components/modal';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useMemo, useState } from 'react';

import type { FlagSummary } from '../../api/feature-flags';
import { plural } from './labels';

interface DeleteDialogProps {
  flag: FlagSummary | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** What deleting does: the flag and its overrides go (R17), everyone gets it as off, and the history stays (R19). */
function consequences(flag: FlagSummary | null): string {
  if (flag === null) return '';
  const count = flag.overrideCounts.on + flag.overrideCounts.off;
  const what = count === 0 ? flag.key : `${flag.key} and its ${plural(count, 'override', 'overrides')}`;
  return `${what} will be deleted, and code that checks the flag will see it as off for everyone. Its history is kept.`;
}

/**
 * Confirms a delete. react-aria's modal traps focus inside the dialog, closes on Escape and returns focus to the
 * Delete button that opened it.
 */
export function DeleteDialog({ flag, isPending, onConfirm, onCancel }: Readonly<DeleteDialogProps>) {
  // Keeps the last flag's text while the dialog closes.
  const [shown, setShown] = useState(flag);
  if (flag !== null && flag !== shown) setShown(flag);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onCancel();
    },
    [onCancel],
  );
  const buttons = useMemo(
    () => (
      <>
        <Button variant="secondary" isDisabled={isPending} onPress={onCancel}>
          Cancel
        </Button>
        <Button danger isPending={isPending} onPress={onConfirm}>
          Delete
        </Button>
      </>
    ),
    [isPending, onCancel, onConfirm],
  );
  const title = `Delete ${shown?.key ?? ''}?`;

  return (
    <Modal isOpen={flag !== null} onOpenChange={onOpenChange} isKeyboardDismissDisabled={isPending}>
      <AlertDialog
        role="alertdialog"
        variant="destructive"
        aria-label={title}
        title={title}
        isCloseable={false}
        buttons={buttons}
      >
        <Text elementType="p">{consequences(shown)}</Text>
      </AlertDialog>
    </Modal>
  );
}
