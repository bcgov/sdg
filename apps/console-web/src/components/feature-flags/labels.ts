import type { Audience, PersonKind } from '../../api/feature-flags';

export const AUDIENCE_LABELS: Readonly<Record<Audience, string>> = {
  portal: 'Portal',
  console: 'Console',
  both: 'Portal and console',
};

export const KIND_LABELS: Readonly<Record<PersonKind, string>> = {
  resident: 'Resident',
  'console-user': 'Console user',
};

export const onOff = (enabled: boolean) => (enabled ? 'On' : 'Off');

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const people = (count: number) => plural(count, 'person', 'people');

export const dateTime = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
