/** What a Settings row shows for a value the profile does not carry (R13). */
export const NOT_PROVIDED = 'Not provided';

export function orNotProvided(value: string | null): string {
  return value ?? NOT_PROVIDED;
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

// UTC throughout, so a birthdate never shifts a day with the visitor's time zone.
const LONG_DATE = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeZone: 'UTC' });

/** A `YYYY-MM-DD` birthdate as a long date ("January 5, 1980"); anything else as sent (KTD4). */
export function formatBirthdate(birthdate: string | null): string {
  if (birthdate === null) return NOT_PROVIDED;
  const match = FULL_DATE.exec(birthdate);
  if (match === null) return birthdate;
  const [year, month, day] = match.slice(1).map(Number);
  if (year === undefined || month === undefined || day === undefined) return birthdate;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC rolls an impossible date (Feb 30) into the next month; show those as sent.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return birthdate;
  }
  return LONG_DATE.format(date);
}

const GENDERS: Readonly<Record<string, string>> = { male: 'Male', female: 'Female', diverse: 'Diverse' };

/** BC Services Card's gender values as labels; `unknown` reads Not provided, anything else as sent (KTD4). */
export function formatGender(gender: string | null): string {
  if (gender === null) return NOT_PROVIDED;
  const key = gender.toLowerCase();
  if (key === 'unknown') return NOT_PROVIDED;
  return GENDERS[key] ?? gender;
}
