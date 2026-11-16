import { Button } from '@repo/design-system/components/button';
import { Heading } from '@repo/design-system/components/heading';

import type { FlagDetail } from '../../api/feature-flags';
import { AUDIENCE_LABELS, onOff } from './labels';

import styles from './feature-flags.module.css';

interface FlagHeaderProps {
  flag: FlagDetail;
  isDeleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/** The flag's key and state at the top of its page, with its edit and delete actions at the right. */
export function FlagHeader({ flag, isDeleting, onEdit, onDelete }: Readonly<FlagHeaderProps>) {
  const { on, off } = flag.overrideCounts;
  return (
    <div className={styles.flagHeader}>
      <div className={styles.flagTitle}>
        <div className={styles.titleRow}>
          <Heading level={2} className={styles.flagKey}>
            {flag.key}
          </Heading>
          <span className={`${styles.badge} ${flag.enabled ? styles.badgeOn : ''}`}>{onOff(flag.enabled)}</span>
        </div>
        {flag.description && <p>{flag.description}</p>}
        <p className={styles.summary}>
          {AUDIENCE_LABELS[flag.audience]} · {flag.rolloutPct}% rollout · {on} forced on, {off} forced off
        </p>
      </div>
      <div className={styles.actions}>
        <Button size="small" variant="secondary" onPress={onEdit}>
          Edit settings
        </Button>
        <Button
          size="small"
          variant="secondary"
          danger
          aria-label={`Delete ${flag.key}`}
          isPending={isDeleting}
          onPress={onDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
