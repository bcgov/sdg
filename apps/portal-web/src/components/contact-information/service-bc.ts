import type { ContactItem } from '.';

/** When Service BC answers. */
export const SERVICE_BC_HOURS =
  'We’re here to help, Monday to Friday from 7:30 am to 5 pm. We’re closed on all statutory holidays.';

/** Service BC's phone lines, including its accessible ones. */
export const SERVICE_BC_CONTACTS: readonly ContactItem[] = [
  {
    type: 'phone',
    label: 'Call Service BC at',
    description: [
      { label: 'Canada and USA toll free:', value: '1-888-356-2741' },
      { label: 'Lower Mainland or outside Canada and USA:', value: '604-660-2355' },
    ],
  },
  {
    type: 'vrs',
    label: 'Video Relay Service (VRS)',
    description: [{ value: '1-800-663-7867' }, { label: 'Outside of Canada/USA:', value: '604-660-2355' }],
  },
  {
    type: 'tdd',
    label: 'Telephone Device for the Deaf (TDD):',
    description: [{ label: 'Across B.C.:', value: '711' }],
  },
];
