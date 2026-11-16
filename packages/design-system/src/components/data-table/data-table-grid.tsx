import {
  FlexRender,
  type Header,
  type Row as TanStackRow,
  type RowData,
  type TableFeatures,
} from '@tanstack/react-table';
import { type JSX, type ReactNode, type RefObject, useCallback, useId, useMemo } from 'react';
import { Cell, Column, Row, Table, TableBody, TableHeader, type SortDescriptor } from 'react-aria-components';

import styles from './data-table.module.css';

const SKELETON_ROWS = 5;

interface GridProps<TFeatures extends TableFeatures, TData extends RowData> {
  /** Names the table, shown above it. */
  caption: string;
  /** Marks the frame busy while a load runs (KTD11). */
  isBusy: boolean;
  headers: readonly Header<TFeatures, TData>[];
  /** The rows to show, or null for skeleton rows while the first load runs. */
  rows: readonly TanStackRow<TFeatures, TData>[] | null;
  /** The sortable column ids (R2). */
  sortable: Readonly<Record<string, unknown>> | undefined;
  sortDescriptor: SortDescriptor | undefined;
  onSort: (column: string) => void;
  getRowHref: ((row: TData) => string) | undefined;
  /** What the body says when it has no rows. */
  emptyMessage: ReactNode;
  gridRef: RefObject<HTMLTableElement | null>;
}

function SortIcon({ direction }: Readonly<{ direction: SortDescriptor['direction'] | undefined }>) {
  const icon = { ascending: '▲', descending: '▼' } as const;
  return (
    <span aria-hidden="true" className={styles['sortIcon']} data-sorted={direction ? true : undefined}>
      {direction ? icon[direction] : '▲'}
    </span>
  );
}

function skeletonRows(columnCount: number) {
  return Array.from({ length: SKELETON_ROWS }, (_row, index) => (
    <Row key={`skeleton-${index}`} id={`skeleton-${index}`} className={styles['row']}>
      {Array.from({ length: columnCount }, (_cell, cell) => (
        <Cell key={cell} className={styles['cell']}>
          <span className={styles['skeleton']} />
        </Cell>
      ))}
    </Row>
  ));
}

/**
 * The react-aria Table (KTD7): sortable headers mapped to and from the table's sort, the first column as the row
 * header, and each row a link when `getRowHref` is given, followed through the app's RouterProvider (KTD9).
 */
function dataRows<TFeatures extends TableFeatures, TData extends RowData>(
  rows: readonly TanStackRow<TFeatures, TData>[],
  getRowHref: ((row: TData) => string) | undefined,
) {
  return rows.map((row) => (
    <Row key={row.id} id={row.id} href={getRowHref?.(row.original)} className={styles['row']}>
      {row.getAllCells().map((cell) => (
        <Cell key={cell.id} className={styles['cell']}>
          <FlexRender cell={cell} />
        </Cell>
      ))}
    </Row>
  ));
}

export function DataTableGrid<TFeatures extends TableFeatures, TData extends RowData>(
  props: Readonly<GridProps<TFeatures, TData>>,
): JSX.Element {
  const { caption, isBusy, headers, rows, sortable, sortDescriptor, onSort, getRowHref, emptyMessage, gridRef } = props;
  const captionId = useId();
  const onSortChange = useCallback((descriptor: SortDescriptor) => onSort(String(descriptor.column)), [onSort]);
  const renderEmptyState = useCallback(() => <p className={styles['message']}>{emptyMessage}</p>, [emptyMessage]);
  const body = useMemo(
    () => (rows ? dataRows(rows, getRowHref) : skeletonRows(headers.length)),
    [rows, getRowHref, headers.length],
  );
  return (
    <>
      <p id={captionId} className={styles['caption']}>
        {caption}
      </p>
      <div className={styles['frame']} aria-busy={isBusy}>
        <Table
          ref={gridRef}
          aria-labelledby={captionId}
          className={styles['table']}
          sortDescriptor={sortDescriptor}
          onSortChange={onSortChange}
        >
          <TableHeader className={styles['header']}>
            {headers.map((header, index) => (
              <Column
                key={header.id}
                id={header.column.id}
                isRowHeader={index === 0}
                allowsSorting={Object.hasOwn(sortable ?? {}, header.column.id)}
                className={styles['column']}
              >
                {({ allowsSorting, sortDirection }): JSX.Element => (
                  <span className={styles['columnLabel']}>
                    <FlexRender header={header} />
                    {allowsSorting && <SortIcon direction={sortDirection} />}
                  </span>
                )}
              </Column>
            ))}
          </TableHeader>
          <TableBody className={styles['body']} renderEmptyState={renderEmptyState}>
            {body}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
