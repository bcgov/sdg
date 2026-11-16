import {
  DataTable,
  dataTableColumnHelper,
  readTableState,
  type DataTableSearchChange,
} from '@repo/design-system/components/data-table';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import type { FlagEvent } from '../../api/feature-flags';
import { action, details } from './history-format';
import { dateTime } from './labels';
import { HISTORY_CONFIG, HISTORY_PREFIX, historyQuery, stringParams } from './table-search';
import { tableStatus, useFlagHistory } from './use-feature-flags';

const column = dataTableColumnHelper<FlagEvent>();

const HISTORY_COLUMNS = [
  column.accessor('createdAt', {
    id: 'when',
    header: 'When',
    cell: (info) => <time dateTime={info.getValue()}>{dateTime.format(new Date(info.getValue()))}</time>,
  }),
  column.accessor((event) => event.actor.name, { id: 'admin', header: 'Admin' }),
  column.accessor(action, { id: 'action', header: 'Action' }),
  column.accessor(details, { id: 'change', header: 'Change' }),
];

const eventId = (event: FlagEvent) => String(event.id);
const NO_EVENTS: readonly FlagEvent[] = [];

/** The cursor as the table's URL holds it: an event id, or null at that end. */
const cursorOf = (id: number | null | undefined) => (id === null || id === undefined ? null : String(id));

/**
 * One flag's history, deleted or not, newest first, in a cursor-mode DataTable whose `h.` params sit beside the list's
 * on the flag's page (R19, R20, KTD10).
 */
export function HistoryTable({ flagKey, hideCaption = false }: Readonly<{ flagKey: string; hideCaption?: boolean }>) {
  const search = useSearch({ from: '/_app/feature-flags/$key' });
  const navigate = useNavigate({ from: '/feature-flags/$key' });
  const query = useMemo(
    () => historyQuery(flagKey, readTableState(search, HISTORY_CONFIG, HISTORY_PREFIX).state),
    [flagKey, search],
  );
  const history = useFlagHistory(query);
  const { data, refetch } = history;
  const onSearchChange = useCallback<DataTableSearchChange>(
    // A table change keeps the page where it is: the router would otherwise scroll it back to the top.
    (next, { replace }) => void navigate({ search: stringParams(next), replace, resetScroll: false }),
    [navigate],
  );
  const retry = useCallback(() => void refetch(), [refetch]);
  const paging = useMemo(
    () => ({ mode: 'cursor' as const, older: cursorOf(data?.older), newer: cursorOf(data?.newer) }),
    [data?.older, data?.newer],
  );
  const messages = useMemo(
    () => ({ empty: `${flagKey} has no history.`, error: "The history couldn't be loaded. Try again in a moment." }),
    [flagKey],
  );
  return (
    <DataTable
      caption={`Changes to ${flagKey}, newest first`}
      hideCaption={hideCaption}
      columns={HISTORY_COLUMNS}
      rows={data?.items ?? NO_EVENTS}
      getRowId={eventId}
      config={HISTORY_CONFIG}
      paging={paging}
      search={search}
      onSearchChange={onSearchChange}
      prefix={HISTORY_PREFIX}
      status={tableStatus(history)}
      onRetry={retry}
      messages={messages}
    />
  );
}
