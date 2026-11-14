import { Button } from '@repo/design-system/components/button';
import { Form } from '@repo/design-system/components/form';
import { Text } from '@repo/design-system/components/text';
import { type SyntheticEvent, useCallback, useMemo, useState } from 'react';

import type { FlagChanges, FlagSummary } from '../../api/feature-flags';
import { FlagFields, rolloutError, type FlagField, type FlagFieldErrors, type FlagFieldValues } from './flag-fields';

import styles from './feature-flags.module.css';

export const fieldValuesOf = (flag: FlagSummary): FlagFieldValues => ({
  description: flag.description ?? '',
  enabled: flag.enabled,
  rolloutPct: flag.rolloutPct,
  audience: flag.audience,
});

/** Only the fields that differ from the flag as core-api last answered (KTD8). */
function changesOf(flag: FlagSummary, values: FlagFieldValues): FlagChanges {
  const description = values.description.trim();
  return {
    ...(description !== (flag.description ?? '') ? { description } : {}),
    ...(values.enabled !== flag.enabled ? { enabled: values.enabled } : {}),
    ...(values.rolloutPct !== flag.rolloutPct ? { rolloutPct: values.rolloutPct } : {}),
    ...(values.audience !== flag.audience ? { audience: values.audience } : {}),
  };
}

interface EditFlagFormProps {
  flag: FlagSummary;
  isPending: boolean;
  onSave: (changes: FlagChanges) => void;
}

/**
 * Edits a flag's description, audience, switch and rollout (R16); the key never changes (R2). Save sends only what
 * changed, and nothing when nothing has. (Save stays enabled: the rollout field commits its value on blur, so a press on
 * Save must still count while the field has focus.) The page remounts the form when core-api's answer changes the flag.
 */
export function EditFlagForm({ flag, isPending, onSave }: Readonly<EditFlagFormProps>) {
  const [values, setValues] = useState<FlagFieldValues>(() => fieldValuesOf(flag));
  const [errors, setErrors] = useState<FlagFieldErrors>({});
  const [isUnchanged, setUnchanged] = useState(false);
  const changes = useMemo(() => changesOf(flag, values), [flag, values]);
  const hasChanges = Object.keys(changes).length > 0;

  const change = useCallback(<F extends FlagField>(field: F, value: FlagFieldValues[F]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _cleared, ...kept }) => kept);
    setUnchanged(false);
  }, []);
  const submit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const found = rolloutError(values.rolloutPct);
      setErrors(found);
      setUnchanged(!hasChanges);
      if (Object.keys(found).length === 0 && hasChanges) onSave(changes);
    },
    [values, hasChanges, changes, onSave],
  );

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={submit}>
      <FlagFields values={values} errors={errors} onChange={change} />
      {isUnchanged && <Text elementType="p">Nothing to save: no field has changed.</Text>}
      <div>
        <Button type="submit" isPending={isPending}>
          Save changes
        </Button>
      </div>
    </Form>
  );
}
