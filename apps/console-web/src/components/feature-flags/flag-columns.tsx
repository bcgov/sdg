import { dataTableColumnHelper } from '@repo/design-system/components/data-table';

import type { FlagSummary } from '../../api/feature-flags';
import { AUDIENCE_LABELS, onOff } from './labels';

const column = dataTableColumnHelper<FlagSummary>();

/** The flag list's columns; each id is the sort column core-api takes (R16), the key the row header. */
export const FLAG_COLUMNS = [
  column.accessor('key', { header: 'Key' }),
  column.accessor('audience', { header: 'Audience', cell: (info) => AUDIENCE_LABELS[info.getValue()] }),
  column.accessor('enabled', { header: 'Switch', cell: (info) => onOff(info.getValue()) }),
  column.accessor('rolloutPct', { header: 'Rollout', cell: (info) => `${info.getValue()}%` }),
  column.accessor((flag) => flag.overrideCounts.on, {
    id: 'overridesOn',
    header: 'Overrides',
    cell: (info) => `${info.getValue()} on, ${info.row.original.overrideCounts.off} off`,
  }),
];
