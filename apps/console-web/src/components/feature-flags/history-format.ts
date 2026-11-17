import { isAudience, type FieldValue, type FlagEvent, type FlagEventAction } from '../../api/feature-flags';
import { AUDIENCE_LABELS, onOff, plural } from './labels';

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
export function details(event: FlagEvent): string {
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
export function action(event: FlagEvent): string {
  const subject = event.subject ? ` for ${event.subject.name ?? 'someone no longer known'}` : '';
  return `${ACTION_LABELS[event.action]}${subject}`;
}
