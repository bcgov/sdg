import { type JSX, useCallback } from 'react';
import { Button, type Key, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';

import styles from './data-table.module.css';

export interface TableSelectOption {
  id: string;
  label: string;
}

interface TableSelectProps {
  label: string;
  value: string;
  options: readonly TableSelectOption[];
  onChange: (id: string) => void;
}

/** A single-choice react-aria Select in the bcgov look, for the toolbar filters and the page size (KTD7). */
export function TableSelect({ label, value, options, onChange }: Readonly<TableSelectProps>): JSX.Element {
  const change = useCallback(
    (key: Key | null) => {
      if (key !== null) onChange(String(key));
    },
    [onChange],
  );
  return (
    <Select className={styles['select']} value={value} onChange={change}>
      <Label className={styles['label']}>{label}</Label>
      <Button className={styles['selectButton']}>
        <SelectValue className={styles['selectValue']} />
        <span aria-hidden="true" className={styles['chevron']}>
          ▾
        </span>
      </Button>
      <Popover className={styles['popover']}>
        <ListBox className={styles['listBox']} items={options}>
          {(option) => (
            <ListBoxItem id={option.id} className={styles['option']}>
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
