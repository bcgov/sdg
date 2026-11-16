import { Button } from '@repo/design-system/components/button';
import {
  DataTable,
  dataTableColumnHelper,
  readTableState,
  type DataTableSearchChange,
  type TableState,
} from '@repo/design-system/components/data-table';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import type { FlagDetail, FlagOverride } from '../../api/feature-flags';
import { KIND_LABELS, onOff } from './labels';
import { OVERRIDES_CONFIG, OVERRIDES_PREFIX, stringParams } from './table-search';
import type { DetailActions } from './use-detail-actions';

type RemoveActions = Pick<DetailActions, 'removeOverride' | 'busyPrincipal'>;

type SortKey = 'name' | 'email' | 'kind' | 'enabled';
const SORT_VALUES: Readonly<Record<SortKey, (override: FlagOverride) => string>> = {
  name: (override) => override.name,
  email: (override) => override.email ?? '',
  kind: (override) => KIND_LABELS[override.kind],
  // Off before On, so descending (the column's first direction) lists On first.
  enabled: (override) => (override.enabled ? '1' : '0'),
};
const isSortKey = (column: string): column is SortKey => Object.hasOwn(SORT_VALUES, column);

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function matches(override: FlagOverride, { search, filters }: TableState): boolean {
  const text = search.toLowerCase();
  if (text && !`${override.name}\n${override.email ?? ''}`.toLowerCase().includes(text)) return false;
  if (filters['enabled'] !== undefined && String(override.enabled) !== filters['enabled']) return false;
  return filters['kind'] === undefined || override.kind === filters['kind'];
}

/**
 * One page of the flag's overrides, which all come with the flag: searched, filtered and sorted here, ties broken by
 * principal id, and a page past the end clamped to the last one, as core-api's numbered lists do.
 */
export function overridesPage(overrides: readonly FlagOverride[], state: TableState) {
  const column = state.sort && isSortKey(state.sort.column) ? state.sort.column : 'name';
  const sign = state.sort?.direction === 'desc' ? -1 : 1;
  const value = SORT_VALUES[column];
  const sorted = overrides
    .filter((override) => matches(override, state))
    .toSorted((a, b) => sign * collator.compare(value(a), value(b)) || (a.principalId < b.principalId ? -1 : 1));
  const lastOffset = Math.max(0, Math.ceil(sorted.length / state.pageSize) - 1) * state.pageSize;
  const offset = Math.min((state.page - 1) * state.pageSize, lastOffset);
  return { items: sorted.slice(offset, offset + state.pageSize), total: sorted.length, offset };
}

function RemoveButton({ override, actions }: Readonly<{ override: FlagOverride; actions: RemoveActions }>) {
  const { removeOverride, busyPrincipal } = actions;
  const remove = useCallback(() => removeOverride(override), [override, removeOverride]);
  return (
    <Button
      size="small"
      variant="secondary"
      aria-label={`Remove the override for ${override.name}`}
      isPending={busyPrincipal === override.principalId}
      onPress={remove}
    >
      Remove
    </Button>
  );
}

const column = dataTableColumnHelper<FlagOverride>();

/** The overrides' columns; each id but the actions' is a sort column, the name the row header. */
function overrideColumns(actions: RemoveActions) {
  return [
    column.accessor('name', { header: 'Name' }),
    column.accessor((override) => override.email ?? '', { id: 'email', header: 'Email' }),
    column.accessor('kind', { header: 'Kind', cell: (info) => KIND_LABELS[info.getValue()] }),
    column.accessor('enabled', { header: 'Override', cell: (info) => onOff(info.getValue()) }),
    column.display({
      id: 'actions',
      header: 'Actions',
      cell: (info) => <RemoveButton override={info.row.original} actions={actions} />,
    }),
  ];
}

const principalId = (override: FlagOverride) => override.principalId;

/** Who the flag is forced on or off for, in a DataTable whose `o.` params sit beside the history's (R18). */
export function OverridesTable({ flag, actions }: Readonly<{ flag: FlagDetail; actions: RemoveActions }>) {
  const search = useSearch({ from: '/_app/feature-flags/$key' });
  const navigate = useNavigate({ from: '/feature-flags/$key' });
  const page = useMemo(
    () => overridesPage(flag.overrides, readTableState(search, OVERRIDES_CONFIG, OVERRIDES_PREFIX).state),
    [flag.overrides, search],
  );
  const { removeOverride, busyPrincipal } = actions;
  const columns = useMemo(() => overrideColumns({ removeOverride, busyPrincipal }), [removeOverride, busyPrincipal]);
  const onSearchChange = useCallback<DataTableSearchChange>(
    (next, { replace }) => void navigate({ search: stringParams(next), replace }),
    [navigate],
  );
  const paging = useMemo(
    () => ({ mode: 'numbered' as const, total: page.total, offset: page.offset }),
    [page.total, page.offset],
  );
  const messages = useMemo(
    () => ({
      empty: `No one has an override for ${flag.key}.`,
      noMatches: 'No overrides match the search or filters.',
    }),
    [flag.key],
  );
  return (
    <DataTable
      caption={`Overrides of ${flag.key}`}
      hideCaption
      columns={columns}
      rows={page.items}
      getRowId={principalId}
      config={OVERRIDES_CONFIG}
      paging={paging}
      search={search}
      onSearchChange={onSearchChange}
      prefix={OVERRIDES_PREFIX}
      status="ready"
      messages={messages}
    />
  );
}
