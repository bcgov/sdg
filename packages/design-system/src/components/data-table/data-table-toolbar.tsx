import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Label, SearchField } from 'react-aria-components';

import { TableSelect } from './data-table-select';
import type { TableConfig, TableFilter } from './table-state';

import styles from './data-table.module.css';

const SEARCH_DEBOUNCE_MS = 300;
const ANY = 'any';

// Copied from console-web's people search.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * The search field's text, applied once typing pauses (R8). The first edit after the field gains focus pushes, as does
 * one that starts from no search; later edits while it keeps focus replace, so one search is one Back step (KTD8).
 * A search the URL changes from outside (Back, Clear filters) replaces the text.
 */
function useSearchText(search: string, onSearch: (text: string, replace: boolean) => void) {
  const [text, setText] = useState(search);
  const debounced = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  const applied = useRef(search);
  const lastDebounced = useRef(debounced);
  const editedSinceFocus = useRef(false);

  useEffect(() => {
    if (search === applied.current) return;
    applied.current = search;
    setText(search);
  }, [search]);

  useEffect(() => {
    // Only a new pause in typing applies; a new `onSearch` alone must not resend stale text.
    if (debounced === lastDebounced.current) return;
    lastDebounced.current = debounced;
    if (debounced === applied.current) return;
    const replace = editedSinceFocus.current && applied.current !== '';
    applied.current = debounced;
    editedSinceFocus.current = true;
    onSearch(debounced, replace);
  }, [debounced, onSearch]);

  const onFocus = useCallback(() => {
    editedSinceFocus.current = false;
  }, []);
  const clear = useCallback(() => {
    applied.current = '';
    setText('');
  }, []);
  return { text, setText, onFocus, clear };
}

function FilterSelect({ filter, value, onChange }: Readonly<FilterSelectProps>): JSX.Element {
  const options = useMemo(
    () => [
      { id: ANY, label: 'Any' },
      ...filter.options.map((option, index) => ({ id: String(index), label: option.label })),
    ],
    [filter],
  );
  const change = useCallback(
    (id: string) => onChange(filter.key, id === ANY ? undefined : filter.options[Number(id)]?.value),
    [filter, onChange],
  );
  const index = filter.options.findIndex((option) => option.value === value);
  return (
    <TableSelect label={filter.label} value={index === -1 ? ANY : String(index)} options={options} onChange={change} />
  );
}

interface FilterSelectProps {
  filter: TableFilter;
  value: string | undefined;
  onChange: (key: string, value: string | undefined) => void;
}

interface ToolbarProps {
  config: TableConfig;
  search: string;
  filters: Readonly<Record<string, string>>;
  onSearch: (text: string, replace: boolean) => void;
  onFilter: (key: string, value: string | undefined) => void;
  onClear: () => void;
}

/** Search and one single-choice select per filter, with Clear filters while any is set (R3). */
export function DataTableToolbar({
  config,
  search,
  filters,
  onSearch,
  onFilter,
  onClear,
}: Readonly<ToolbarProps>): JSX.Element {
  const { text, setText, onFocus, clear: clearText } = useSearchText(search, onSearch);
  const isSet = search !== '' || Object.keys(filters).length > 0;
  const clear = useCallback(() => {
    clearText();
    onClear();
  }, [clearText, onClear]);
  return (
    <div className={styles['toolbar']}>
      {config.search && (
        <SearchField className={styles['field']} value={text} onChange={setText} onFocus={onFocus}>
          <Label className={styles['label']}>Search</Label>
          <Input className={styles['input']} />
        </SearchField>
      )}
      {config.filters?.map((filter) => (
        <FilterSelect key={filter.key} filter={filter} value={filters[filter.key]} onChange={onFilter} />
      ))}
      {isSet && (
        <Button className={styles['button']} onPress={clear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
