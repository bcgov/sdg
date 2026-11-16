import { useCallback } from 'react';

import type { FlagChanges, FlagDetail } from '../../api/feature-flags';
import { EditFlagForm } from './edit-flag-form';
import { FormDialog } from './form-dialog';
import type { DetailActions } from './use-detail-actions';

interface EditFlagDialogProps {
  flag: FlagDetail;
  actions: Pick<DetailActions, 'save' | 'isSaving'>;
  isOpen: boolean;
  onClose: () => void;
}

/** The flag's settings in a dialog, which a successful save closes (R16). It starts from the flag each time it opens. */
export function EditFlagDialog({ flag, actions: { save, isSaving }, isOpen, onClose }: Readonly<EditFlagDialogProps>) {
  const onSave = useCallback((changes: FlagChanges) => save(changes, onClose), [save, onClose]);
  return (
    <FormDialog title={`Edit ${flag.key}`} isOpen={isOpen} isPending={isSaving} onClose={onClose}>
      <EditFlagForm flag={flag} isPending={isSaving} onSave={onSave} onCancel={onClose} />
    </FormDialog>
  );
}
