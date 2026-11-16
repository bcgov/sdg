import { type JSX, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
 * A search the URL changes from outside (Back) replaces the text. Clearing the field (its × or Escape) applies at once.
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
    setText('');
    if (applied.current === '') return;
    applied.current = '';
    onSearch('', false);
  }, [onSearch]);
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

/**
 * The filters (one single-choice select each) on the left, then Clear filters while any is set, and search on the
 * right with its own clear button (R3).
 */
export function DataTableToolbar({
  config,
  search,
  filters,
  onSearch,
  onFilter,
  onClear,
}: Readonly<ToolbarProps>): JSX.Element {
  const { text, setText, onFocus, clear } = useSearchText(search, onSearch);
  const isFiltered = Object.keys(filters).length > 0;
  const filtersId = useId();
  return (
    <div className={styles['toolbar']}>
      {config.filters?.length ? (
        <fieldset aria-labelledby={filtersId} className={styles['filters']}>
          <span id={filtersId} className={styles['filtersLabel']}>
            Filters
          </span>
          {config.filters.map((filter) => (
            <FilterSelect key={filter.key} filter={filter} value={filters[filter.key]} onChange={onFilter} />
          ))}
        </fieldset>
      ) : null}
      {isFiltered && (
        <Button className={styles['button']} onPress={onClear}>
          Clear filters
        </Button>
      )}
      {config.search && (
        <SearchField
          className={`${styles['field']} ${styles['search']}`}
          value={text}
          onChange={setText}
          onClear={clear}
          onFocus={onFocus}
        >
          <Label className={styles['label']}>Search</Label>
          <div className={styles['searchInput']}>
            <Input className={styles['input']} />
            <Button className={styles['clearSearch']} aria-label="Clear search">
              <span aria-hidden="true">×</span>
            </Button>
          </div>
        </SearchField>
      )}
    </div>
  );
}
