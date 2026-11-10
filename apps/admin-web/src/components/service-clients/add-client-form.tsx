import { Button } from '@repo/design-system/components/button';
import { Form } from '@repo/design-system/components/form';
import { TextField } from '@repo/design-system/components/text-field';
import { type FormEvent, useCallback, useState } from 'react';

import { ApiError, apiErrorKind } from '../../api/http';
import type { NewServiceClient, ServiceClient } from '../../api/service-clients';
import { failureNotice, type Notice, NoticeAlert } from './notice';
import { useAddServiceClient } from './use-registry';

import styles from './registry.module.css';

type Field = keyof NewServiceClient;
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY_CLIENT: NewServiceClient = { clientId: '', displayName: '' };

const FIELDS: readonly Field[] = ['clientId', 'displayName'];

function missingFields({ clientId, displayName }: NewServiceClient): FieldErrors {
  return {
    ...(clientId === '' ? { clientId: 'Enter a client ID' } : {}),
    ...(displayName === '' ? { displayName: 'Enter a display name' } : {}),
  };
}

/** core-api's 400 reasons carry the field as a prefix (`clientId: …`); anything else belongs to the whole form. */
function invalidFields(reasons: readonly string[]): { fields: FieldErrors; rest: string[] } {
  const fields: FieldErrors = {};
  const rest: string[] = [];
  for (const reason of reasons) {
    const field = FIELDS.find((name) => reason.startsWith(`${name}: `));
    if (field) fields[field] = [fields[field], reason.slice(field.length + 2)].filter(Boolean).join(' ');
    else rest.push(reason);
  }
  return { fields, rest };
}

interface Failure {
  fields: FieldErrors;
  notice: Notice | null;
}

function addFailure(error: unknown, input: NewServiceClient, retry: () => void): Failure {
  const kind = apiErrorKind(error);
  if (kind === 'conflict') return { fields: { clientId: `${input.clientId} is already registered` }, notice: null };
  if (kind !== 'invalid' || !(error instanceof ApiError)) {
    return { fields: {}, notice: failureNotice(error, input.clientId, retry) };
  }
  const { fields, rest } = invalidFields(error.reasons);
  const notice: Notice | null =
    rest.length > 0
      ? { variant: 'danger', title: `${input.clientId} was not added`, description: rest.join(' ') }
      : null;
  return { fields, notice };
}

/** Form state for adding a client: what was typed stays until core-api confirms the add. */
function useAddClientForm(onAdded: (client: ServiceClient) => void) {
  const [values, setValues] = useState<NewServiceClient>(EMPTY_CLIENT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const { mutate, isPending } = useAddServiceClient();

  const run = useCallback(
    (input: NewServiceClient) => {
      const attempt = () =>
        mutate(input, {
          onSuccess: (client) => {
            setValues(EMPTY_CLIENT);
            onAdded(client);
          },
          onError: (error) => {
            const failure = addFailure(error, input, attempt);
            setErrors(failure.fields);
            setNotice(failure.notice);
          },
        });
      attempt();
    },
    [mutate, onAdded],
  );

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const input = { clientId: values.clientId.trim(), displayName: values.displayName.trim() };
      const missing = missingFields(input);
      setErrors(missing);
      setNotice(null);
      if (Object.keys(missing).length === 0) run(input);
    },
    [values, run],
  );

  const change = useCallback((field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _cleared, ...kept }) => kept);
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);
  return { values, errors, notice, isPending, submit, change, dismiss };
}

interface AddClientFormProps {
  onAdded: (client: ServiceClient) => void;
}

/** Registers a Keycloak client id. A refused add keeps what was typed and says why next to the field. */
export function AddClientForm({ onAdded }: AddClientFormProps) {
  const { values, errors, notice, isPending, submit, change, dismiss } = useAddClientForm(onAdded);
  const changeClientId = useCallback((value: string) => change('clientId', value), [change]);
  const changeDisplayName = useCallback((value: string) => change('displayName', value), [change]);

  return (
    <Form className={styles.form} validationBehavior="aria" onSubmit={submit}>
      <TextField
        label="Client ID"
        description="The Keycloak client id of the service account, e.g. my-service-1234"
        name="clientId"
        value={values.clientId}
        onChange={changeClientId}
        isInvalid={errors.clientId !== undefined}
        errorMessage={errors.clientId}
      />
      <TextField
        label="Display name"
        description="Who the client belongs to, as administrators should see it"
        name="displayName"
        value={values.displayName}
        onChange={changeDisplayName}
        isInvalid={errors.displayName !== undefined}
        errorMessage={errors.displayName}
      />
      {notice && <NoticeAlert notice={notice} onDismiss={dismiss} />}
      <div>
        <Button type="submit" isPending={isPending}>
          Add service account
        </Button>
      </div>
    </Form>
  );
}
