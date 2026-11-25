import { Radio, RadioGroup } from '@repo/design-system/components/radio';
import { useCallback, useId } from 'react';

import styles from './search-tools.module.css';

export type ServiceType = 'all' | 'service' | 'platform';

export const DEFAULT_SERVICE_TYPE: ServiceType = 'all';

interface TypeFilterProps {
  value: ServiceType;
  onChange: (value: ServiceType) => void;
}

function isServiceType(value: string): value is ServiceType {
  return value === 'all' || value === 'service' || value === 'platform';
}

/** The Type filter, shared by the sidebar and the sheet. Presentational for now: it doesn't filter the results. */
export function TypeFilter({ value, onChange }: Readonly<TypeFilterProps>) {
  const titleId = useId();
  const change = useCallback(
    (next: string) => {
      if (isServiceType(next)) onChange(next);
    },
    [onChange],
  );
  return (
    <div className={styles['filter']}>
      <h3 id={titleId} className={styles['filterTitle']}>
        Type
      </h3>
      <RadioGroup aria-labelledby={titleId} orientation="vertical" value={value} onChange={change}>
        <Radio value="all">All</Radio>
        <Radio value="service">Service</Radio>
        <Radio value="platform">Platform</Radio>
      </RadioGroup>
    </div>
  );
}
