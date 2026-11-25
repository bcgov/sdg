import { Link } from '@repo/design-system/components/link';
import { faAt, faFax, faPhone, faTty, faVideo, FontAwesomeIcon, type IconDefinition } from '@repo/design-system/icons';

import { SupplementaryBlock } from '../supplementary-block';

import styles from './contact-information.module.css';

/** How to reach someone; it picks the item's icon and how its values link (`email` by mail, the rest by phone). */
export type ContactType = 'phone' | 'fax' | 'email' | 'vrs' | 'tdd';

/** One number or address, with an optional line saying who it's for, e.g. "Canada and USA toll free:". */
export interface ContactEntry {
  label?: string;
  value: string;
}

export interface ContactItem {
  type: ContactType;
  /** What the item is, e.g. "Call Service BC at". */
  label: string;
  /** Its numbers or addresses, each shown as a link. */
  description: readonly ContactEntry[];
}

interface ContactInformationProps {
  /** A line above the items, e.g. office hours. */
  description?: string;
  items: readonly ContactItem[];
}

const ICONS: Record<ContactType, IconDefinition> = {
  phone: faPhone,
  fax: faFax,
  email: faAt,
  vrs: faVideo,
  tdd: faTty,
};

/** A `tel:` link for a number (digits and a leading +), a `mailto:` link for an address. */
function hrefFor(type: ContactType, value: string): string {
  return type === 'email' ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, '')}`;
}

/** A "Contact information" panel: an optional description, then each way to get in touch with its icon. */
export function ContactInformation({ description, items }: Readonly<ContactInformationProps>) {
  return (
    <SupplementaryBlock title="Contact information" tone="dark" spacing="medium" description={description}>
      <ul className={styles['items']}>
        {items.map((item) => (
          <li key={`${item.type}:${item.label}`} className={styles['item']}>
            <span className={styles['badge']} aria-hidden="true">
              <FontAwesomeIcon icon={ICONS[item.type]} className={styles['icon']} />
            </span>
            <div className={styles['text']}>
              <p className={styles['label']}>{item.label}</p>
              <ul className={styles['entries']}>
                {item.description.map(({ label, value }) => (
                  <li key={`${label ?? ''}:${value}`} className={styles['entry']}>
                    {label !== undefined && <span>{label}</span>}
                    <Link href={hrefFor(item.type, value)}>{value}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>
    </SupplementaryBlock>
  );
}
