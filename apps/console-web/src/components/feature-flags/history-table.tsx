import {
  DataTable,
  dataTableColumnHelper,
  readTableState,
  type DataTableSearchChange,
} from '@repo/design-system/components/data-table';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { isAudience, type FieldValue, type FlagEvent, type FlagEventAction } from '../../api/feature-flags';
import { AUDIENCE_LABELS, dateTime, onOff, plural } from './labels';
import { HISTORY_CONFIG, HISTORY_PREFIX, historyQuery, stringParams } from './table-search';
import { tableStatus, useFlagHistory } from './use-feature-flags';

const ACTION_LABELS: Readonly<Record<FlagEventAction, string>> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  override_set: 'Override set',
  override_removed: 'Override removed',
};

/** core-api records changes under the column names. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  description: 'Description',
  enabled: 'Switch',
  rollout_pct: 'Rollout',
  audience: 'Audience',
};

function formatValue(field: string, value: FieldValue): string {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return onOff(value).toLowerCase();
  if (field === 'rollout_pct') return `${value}%`;
  if (field === 'audience' && isAudience(value)) return AUDIENCE_LABELS[value];
  return `“${value}”`;
}

/** "Rollout: 50% → 80%", or a delete's "3 overrides removed". */
function details(event: FlagEvent): string {
  const isOverride = event.action === 'override_set' || event.action === 'override_removed';
  return Object.entries(event.changes)
    .map(([field, change]) => {
      if (typeof change === 'number') return `${plural(change, 'override', 'overrides')} removed`;
      const label = isOverride ? 'Override' : (FIELD_LABELS[field] ?? field);
      const to = formatValue(field, change.to);
      return change.from === null ? `${label}: ${to}` : `${label}: ${formatValue(field, change.from)} → ${to}`;
    })
    .join('; ');
}

/** "Override set for Grace Hopper". */
function action(event: FlagEvent): string {
  const subject = event.subject ? ` for ${event.subject.name ?? 'someone no longer known'}` : '';
  return `${ACTION_LABELS[event.action]}${subject}`;
}

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
export function HistoryTable({ flagKey }: Readonly<{ flagKey: string }>) {
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
