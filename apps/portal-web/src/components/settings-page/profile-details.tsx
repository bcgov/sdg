import { Details, type DetailsItem } from '@repo/design-system/components/details';
import { useMemo } from 'react';

import type { Profile } from '../../profile/api';
import { formatBirthdate, formatGender, NOT_PROVIDED, orNotProvided } from '../../profile/format';
import { ChangeLink } from './change-link';

import styles from './settings-page.module.css';

/** Keys each line by its text and how often that text has appeared so far, so repeated lines stay unique. */
function keyedLines(lines: readonly string[]) {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const occurrence = (seen.get(line) ?? 0) + 1;
    seen.set(line, occurrence);
    return { key: `${occurrence}:${line}`, line };
  });
}

function addressValue(address: string[] | null) {
  if (address === null) return NOT_PROVIDED;
  return (
    <span className={styles['lines']}>
      {keyedLines(address).map(({ key, line }) => (
        <span key={key}>{line}</span>
      ))}
    </span>
  );
}

/** The Profile section's rows (R11): identity details from the resident's BC Services Card. */
export function ProfileDetails({ profile }: Readonly<{ profile: Profile }>) {
  const items = useMemo(
    (): DetailsItem[] => [
      {
        id: 'name',
        label: 'Full Name',
        value: orNotProvided(profile.name),
        extra: <ChangeLink anchor="name" field="full name" />,
      },
      { id: 'birthdate', label: 'Date of Birth', value: formatBirthdate(profile.birthdate) },
      {
        id: 'gender',
        label: 'Gender',
        value: formatGender(profile.gender),
        extra: <ChangeLink anchor="gender" field="gender" />,
      },
      {
        id: 'address',
        label: 'Address',
        value: addressValue(profile.address),
        extra: <ChangeLink anchor="address" field="address" />,
      },
    ],
    [profile],
  );
  return <Details items={items} />;
}

/** The Communication section's rows (R16): contact details, with nowhere to change them yet. */
export function CommunicationDetails({ profile }: Readonly<{ profile: Profile }>) {
  const items = useMemo(
    (): DetailsItem[] => [
      { id: 'email', label: 'Email', value: orNotProvided(profile.email) },
      { id: 'phone', label: 'Phone Number', value: orNotProvided(profile.phoneNumber) },
    ],
    [profile],
  );
  return <Details items={items} />;
}
