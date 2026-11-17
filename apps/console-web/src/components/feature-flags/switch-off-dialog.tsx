import { AlertDialog } from '@repo/design-system/components/alert-dialog';
import { Button } from '@repo/design-system/components/button';
import { Modal } from '@repo/design-system/components/modal';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useMemo } from 'react';

import type { FlagSummary } from '../../api/feature-flags';
import { people } from './labels';

interface SwitchOffDialogProps {
  flag: FlagSummary;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** What turning the switch off does: no one gets the flag, "on" overrides included; they apply again once it's on (R21). */
function consequences({ key, overrideCounts: { on } }: FlagSummary): string {
  if (on === 0) return `Everyone stops getting ${key}.`;
  return (
    `Everyone stops getting ${key}, including the ${people(on)} with an “on” override. ` +
    'Their overrides apply again when you turn it back on.'
  );
}

/** Confirms turning a flag off from its overview, the riskier direction; turning it on needs no confirmation. */
export function SwitchOffDialog({ flag, isOpen, onConfirm, onCancel }: Readonly<SwitchOffDialogProps>) {
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onCancel();
    },
    [onCancel],
  );
  const buttons = useMemo(
    () => (
      <>
        <Button variant="secondary" onPress={onCancel}>
          Cancel
        </Button>
        <Button danger onPress={onConfirm}>
          Turn off
        </Button>
      </>
    ),
    [onCancel, onConfirm],
  );
  const title = `Turn ${flag.key} off?`;
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog
        role="alertdialog"
        variant="destructive"
        aria-label={title}
        title={title}
        isCloseable={false}
        buttons={buttons}
      >
        <Text elementType="p">{consequences(flag)}</Text>
      </AlertDialog>
    </Modal>
  );
}
