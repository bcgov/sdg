import { Details, type DetailsItem } from '@repo/design-system/components/details';
import { FontAwesomeIcon, faUser } from '@repo/design-system/icons';
import { useMemo } from 'react';

import type { Profile } from '../../profile/api';
import { formatBirthdate, NOT_PROVIDED, orNotProvided } from '../../profile/format';
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

/** A stand-in for the resident's photograph until the portal can show it. */
const PHOTOGRAPH_PLACEHOLDER = (
  <span className={styles['photograph']}>
    <FontAwesomeIcon icon={faUser} aria-hidden={false} aria-label="Photograph not available" />
  </span>
);

/** The Profile section's rows (R11): identity details from the resident's BC Services Card. */
export function ProfileDetails({ profile }: Readonly<{ profile: Profile }>) {
  const items = useMemo(
    (): DetailsItem[] => [
      { id: 'photograph', label: 'Photograph', value: PHOTOGRAPH_PLACEHOLDER },
      { id: 'name', label: 'Full Name', value: orNotProvided(profile.name) },
      { id: 'birthdate', label: 'Date of Birth', value: formatBirthdate(profile.birthdate) },
      {
        id: 'address',
        label: 'Address',
        value: addressValue(profile.address),
        extra: <ChangeLink anchor="address">Change my address</ChangeLink>,
      },
    ],
    [profile],
  );
  return <Details items={items} bordered />;
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
  return <Details items={items} bordered />;
}
