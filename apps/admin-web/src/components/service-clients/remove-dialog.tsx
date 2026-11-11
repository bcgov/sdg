import { AlertDialog } from '@repo/design-system/components/alert-dialog';
import { Button } from '@repo/design-system/components/button';
import { Modal } from '@repo/design-system/components/modal';
import { Text } from '@repo/design-system/components/text';
import { useCallback, useMemo, useState } from 'react';

import type { ServiceClient } from '../../api/service-clients';

interface RemoveDialogProps {
  client: ServiceClient | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms a removal. react-aria's modal traps focus inside the dialog, closes on Escape and returns focus to the
 * Remove button that opened it.
 */
export function RemoveDialog({ client, isPending, onConfirm, onCancel }: Readonly<RemoveDialogProps>) {
  // Keeps the last client's text while the dialog closes.
  const [shown, setShown] = useState(client);
  if (client !== null && client !== shown) setShown(client);

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
          Remove
        </Button>
      </>
    ),
    [isPending, onCancel, onConfirm],
  );
  const clientId = shown?.clientId ?? '';

  return (
    <Modal isOpen={client !== null} onOpenChange={onOpenChange} isKeyboardDismissDisabled={isPending}>
      <AlertDialog
        role="alertdialog"
        variant="destructive"
        aria-label={`Remove ${clientId}?`}
        title={`Remove ${clientId}?`}
        isCloseable={false}
        buttons={buttons}
      >
        <Text elementType="p">
          {shown?.displayName} ({clientId}) will no longer be able to call the gateway, from its next request on. Its
          history stays in the log.
        </Text>
      </AlertDialog>
    </Modal>
  );
}
