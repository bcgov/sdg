import { NumberField } from '@repo/design-system/components/number-field';
import { Radio, RadioGroup } from '@repo/design-system/components/radio';
import { Switch } from '@repo/design-system/components/switch';
import { TextArea } from '@repo/design-system/components/text-area';
import { useCallback } from 'react';

import { AUDIENCES, isAudience, type Audience } from '../../api/feature-flags';
import { AUDIENCE_LABELS } from './labels';

/** A flag's editable settings as a form holds them; `description` is '' for none. */
export interface FlagFieldValues {
  readonly description: string;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly audience: Audience;
}

export type FlagField = keyof FlagFieldValues;
export type FlagFieldErrors = Partial<Record<FlagField | 'key', string>>;

export const DESCRIPTION_MAX = 500;

/** A rollout the server accepts: an integer from 0 to 100 (KTD13); an emptied field is NaN. */
export function rolloutError(rolloutPct: number): FlagFieldErrors {
  return Number.isInteger(rolloutPct) ? {} : { rolloutPct: 'Enter a rollout percentage from 0 to 100' };
}

function AudienceField({
  audience,
  onChange,
}: Readonly<{ audience: Audience; onChange: FlagFieldsProps['onChange'] }>) {
  const change = useCallback(
    (value: string) => {
      if (isAudience(value)) onChange('audience', value);
    },
    [onChange],
  );
  return (
    <RadioGroup
      label="Audience"
      description="The apps whose people the flag applies to"
      orientation="horizontal"
      flexWrap="wrap"
      value={audience}
      onChange={change}
    >
      {AUDIENCES.map((value) => (
        <Radio key={value} value={value}>
          {AUDIENCE_LABELS[value]}
        </Radio>
      ))}
    </RadioGroup>
  );
}

interface FlagFieldsProps {
  values: FlagFieldValues;
  errors: FlagFieldErrors;
  onChange: <F extends FlagField>(field: F, value: FlagFieldValues[F]) => void;
}

/** Description, audience, the on/off switch and the rollout percentage, shared by the create and edit forms. */
export function FlagFields({ values, errors, onChange }: Readonly<FlagFieldsProps>) {
  const changeDescription = useCallback((value: string) => onChange('description', value), [onChange]);
  const changeEnabled = useCallback((value: boolean) => onChange('enabled', value), [onChange]);
  const changeRollout = useCallback((value: number) => onChange('rolloutPct', value), [onChange]);

  return (
    <>
      <TextArea
        label="Description"
        description="Optional: what the flag turns on, for other administrators"
        value={values.description}
        maxLength={DESCRIPTION_MAX}
        onChange={changeDescription}
        isInvalid={errors.description !== undefined}
        errorMessage={errors.description}
      />
      <AudienceField audience={values.audience} onChange={onChange} />
      <Switch isSelected={values.enabled} onChange={changeEnabled}>
        On
      </Switch>
      <NumberField
        label="Rollout percentage"
        description="The share of people the flag is on for while it is on; overrides come before it"
        minValue={0}
        maxValue={100}
        step={1}
        value={values.rolloutPct}
        onChange={changeRollout}
        isInvalid={errors.rolloutPct !== undefined}
        errorMessage={errors.rolloutPct}
      />
    </>
  );
}
