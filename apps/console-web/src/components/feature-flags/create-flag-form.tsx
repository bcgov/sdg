import { Button } from '@repo/design-system/components/button';
import { Form } from '@repo/design-system/components/form';
import { TextField } from '@repo/design-system/components/text-field';
import { type SyntheticEvent, useCallback, useEffect, useState } from 'react';

import { FLAG_KEY_PATTERN, type FlagSummary, type NewFlag } from '../../api/feature-flags';
import { ApiError, apiErrorKind } from '../../api/http';
import { type Notice, NoticeAlert } from '../service-clients/notice';
import { FlagFields, rolloutError, type FlagFieldErrors, type FlagFieldValues } from './flag-fields';
import { useCreateFlag } from './use-feature-flags';
import { flagFailureNotice } from './use-flag-feedback';

import styles from './feature-flags.module.css';

type Values = FlagFieldValues & { readonly key: string };

/** A new flag starts off, for the portal, at 0%: switching it on then releases it to no one yet (KTD12). */
const EMPTY_FLAG: Values = { key: '', description: '', enabled: false, rolloutPct: 0, audience: 'portal' };
const FIELDS: readonly (keyof FlagFieldErrors)[] = ['key', 'description', 'enabled', 'rolloutPct', 'audience'];

function clientErrors({ key, rolloutPct }: Values): FlagFieldErrors {
  const keyError = FLAG_KEY_PATTERN.test(key)
    ? {}
    : { key: 'Use 2 to 63 lower-case letters, digits or _, starting with a letter, e.g. new_search' };
  return { ...keyError, ...rolloutError(rolloutPct) };
}

/** core-api's 400 reasons carry the field as a prefix (`key: …`); anything else belongs to the whole form. */
function failure(
  error: unknown,
  input: NewFlag,
  retry: () => void,
): { errors: FlagFieldErrors; notice: Notice | null } {
  const reasons = error instanceof ApiError ? error.reasons : [];
  if (apiErrorKind(error) === 'conflict') return { errors: { key: reasons.join(' ') }, notice: null };
  if (apiErrorKind(error) !== 'invalid') return { errors: {}, notice: flagFailureNotice(error, input.key, retry) };
  const errors: FlagFieldErrors = {};
  const rest: string[] = [];
  for (const reason of reasons) {
    const field = FIELDS.find((name) => reason.startsWith(`${name}: `));
    if (field) errors[field] = reason.slice(field.length + 2);
    else rest.push(reason);
  }
  const notice: Notice | null =
    rest.length > 0 ? { variant: 'danger', title: `${input.key} was not created`, description: rest.join(' ') } : null;
  return { errors, notice };
}

const toNewFlag = ({ key, description, enabled, rolloutPct, audience }: Values): NewFlag => {
  const trimmed = description.trim();
  return { key: key.trim(), ...(trimmed ? { description: trimmed } : {}), enabled, rolloutPct, audience };
};

/** Form state for creating a flag: what was typed stays until core-api confirms the flag. */
function useCreateFlagForm(onCreated: (flag: FlagSummary) => void) {
  const [values, setValues] = useState<Values>(EMPTY_FLAG);
  const [errors, setErrors] = useState<FlagFieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const { mutate, isPending } = useCreateFlag();

  const run = useCallback(
    (input: NewFlag) => {
      const attempt = () =>
        mutate(input, {
          onSuccess: (flag) => {
            setValues(EMPTY_FLAG);
            onCreated(flag);
          },
          onError: (error) => {
            const result = failure(error, input, attempt);
            setErrors(result.errors);
            setNotice(result.notice);
          },
        });
      attempt();
    },
    [mutate, onCreated],
  );

  const submit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const input = { ...values, key: values.key.trim() };
      const found = clientErrors(input);
      setErrors(found);
      setNotice(null);
      if (Object.keys(found).length === 0) run(toNewFlag(input));
    },
    [values, run],
  );

  const change = useCallback((field: keyof Values, value: Values[keyof Values]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _cleared, ...kept }) => kept);
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);
  return { values, errors, notice, isPending, submit, change, dismiss };
}

interface CreateFlagFormProps {
  onCreated: (flag: FlagSummary) => void;
  /** Tells the dialog around the form when a create is in flight, so it stays open until core-api answers. */
  onPendingChange: (isPending: boolean) => void;
  onCancel: () => void;
}

/** Creates a flag (R15). A refused create keeps what was typed and says why next to the field. */
export function CreateFlagForm({ onCreated, onPendingChange, onCancel }: Readonly<CreateFlagFormProps>) {
  const { values, errors, notice, isPending, submit, change, dismiss } = useCreateFlagForm(onCreated);
  const changeKey = useCallback((value: string) => change('key', value), [change]);
  useEffect(() => onPendingChange(isPending), [isPending, onPendingChange]);

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={submit}>
      <TextField
        label="Key"
        description="How code refers to the flag; it can't be changed later, e.g. new_search"
        name="key"
        value={values.key}
        onChange={changeKey}
        isInvalid={errors.key !== undefined}
        errorMessage={errors.key}
      />
      <FlagFields values={values} errors={errors} onChange={change} />
      {notice && <NoticeAlert notice={notice} onDismiss={dismiss} />}
      <div className={styles.actions}>
        <Button type="submit" isPending={isPending}>
          Create feature flag
        </Button>
        <Button variant="secondary" isDisabled={isPending} onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}
