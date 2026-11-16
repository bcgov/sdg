import { type JSX, useCallback, useEffect, useRef } from 'react';
import { Button } from 'react-aria-components';

import { TableSelect } from './data-table-select';
import { PAGE_SIZES, type PageSize, type TableCursor } from './table-state';

import styles from './data-table.module.css';

/** A pager control: what it says, whether it has somewhere to go, where it goes, and its opposite (R10). */
export interface PagerControl {
  name: string;
  isDisabled: boolean;
  go: () => void;
  opposite: string;
}

/** Numbered mode: First, Previous, Next and Last (R5). */
export function numberedControls(page: number, pageCount: number, goToPage: (page: number) => void): PagerControl[] {
  return [
    { name: 'First', isDisabled: page <= 1, go: () => goToPage(1), opposite: 'Next' },
    { name: 'Previous', isDisabled: page <= 1, go: () => goToPage(page - 1), opposite: 'Next' },
    { name: 'Next', isDisabled: page >= pageCount, go: () => goToPage(page + 1), opposite: 'Previous' },
    { name: 'Last', isDisabled: page >= pageCount, go: () => goToPage(pageCount), opposite: 'Previous' },
  ];
}

/** Cursor mode: Newest, Newer and Older, with no total (R6). */
export function cursorControls(
  older: string | null,
  newer: string | null,
  goToCursor: (cursor: TableCursor | null) => void,
): PagerControl[] {
  return [
    { name: 'Newest', isDisabled: !newer, go: () => goToCursor(null), opposite: 'Older' },
    { name: 'Newer', isDisabled: !newer, go: () => goToCursor(newer ? { after: newer } : null), opposite: 'Older' },
    { name: 'Older', isDisabled: !older, go: () => goToCursor(older ? { before: older } : null), opposite: 'Newer' },
  ];
}

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ id: String(size), label: String(size) }));

interface PagerProps {
  /** "Showing X–Y of N" and "Page P of M", numbered mode only. */
  range?: string;
  pageLabel?: string;
  controls: readonly PagerControl[];
  /** While the next page loads: every control disabled, focus restored once it settles (KTD11). */
  isBusy: boolean;
  pageSize: PageSize;
  onPageSize: (size: PageSize) => void;
  /** Moves focus to the table's first row; false when it has none. */
  focusFirstRow: () => boolean;
}

/**
 * After a press settles, keeps focus on the pressed control, or, when it has run out of pages, moves it to the first
 * row (or the opposite control when the table has no rows) instead of losing it to the page (R10, KTD11).
 */
function usePagerFocus(controls: readonly PagerControl[], isBusy: boolean, focusFirstRow: () => boolean) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pressed = useRef<PagerControl | null>(null);
  useEffect(() => {
    const control = pressed.current;
    if (isBusy || !control) return;
    pressed.current = null;
    const current = controls.find((candidate) => candidate.name === control.name);
    const focused = document.activeElement;
    if (current && !current.isDisabled) {
      if (!focused || focused === document.body || focused === buttons.current.get(control.name)) {
        buttons.current.get(control.name)?.focus();
      }
      return;
    }
    if (!focusFirstRow()) buttons.current.get(control.opposite)?.focus();
  });
  const press = useCallback((control: PagerControl) => {
    pressed.current = control;
    control.go();
  }, []);
  return { buttons, press };
}

export function DataTablePager(props: Readonly<PagerProps>): JSX.Element {
  const { range, pageLabel, controls, isBusy, pageSize, onPageSize, focusFirstRow } = props;
  const { buttons, press } = usePagerFocus(controls, isBusy, focusFirstRow);
  const changePageSize = useCallback(
    (id: string) => {
      const size = PAGE_SIZES.find((candidate) => String(candidate) === id);
      if (size) onPageSize(size);
    },
    [onPageSize],
  );
  const button = (control: PagerControl) => (
    <PagerButton
      key={control.name}
      control={control}
      isDisabled={isBusy || control.isDisabled}
      onPress={press}
      buttons={buttons.current}
    />
  );
  return (
    <nav aria-label="Pagination" className={styles['footer']}>
      {range && <p className={styles['range']}>{range}</p>}
      <TableSelect
        label="Rows per page"
        value={String(pageSize)}
        options={PAGE_SIZE_OPTIONS}
        onChange={changePageSize}
      />
      <div className={styles['pager']}>
        {controls.slice(0, 2).map(button)}
        {pageLabel && <span className={styles['pageLabel']}>{pageLabel}</span>}
        {controls.slice(2).map(button)}
      </div>
    </nav>
  );
}

interface PagerButtonProps {
  control: PagerControl;
  isDisabled: boolean;
  onPress: (control: PagerControl) => void;
  buttons: Map<string, HTMLButtonElement>;
}

function PagerButton({ control, isDisabled, onPress, buttons }: Readonly<PagerButtonProps>) {
  const ref = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) buttons.set(control.name, element);
      else buttons.delete(control.name);
    },
    [buttons, control.name],
  );
  const press = useCallback(() => onPress(control), [onPress, control]);
  return (
    <Button ref={ref} className={styles['button']} isDisabled={isDisabled} onPress={press}>
      {control.name}
    </Button>
  );
}
