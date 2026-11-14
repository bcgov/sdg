import { useMemo } from 'react';

import type { FlagSummary } from '../../api/feature-flags';
import { Link } from '../link';
import { AUDIENCE_LABELS, onOff } from './labels';

import styles from './feature-flags.module.css';

/** The key's link covers the row (CSS), so a press anywhere on it opens the flag; keyboard users Tab to the link. */
function FlagRow({ flag }: Readonly<{ flag: FlagSummary }>) {
  const params = useMemo(() => ({ key: flag.key }), [flag.key]);
  const { on, off } = flag.overrideCounts;
  return (
    <tr className={styles.flagRow}>
      <th scope="row" className={styles.rowLink}>
        <Link to="/feature-flags/$key" params={params}>
          {flag.key}
        </Link>
      </th>
      <td>{AUDIENCE_LABELS[flag.audience]}</td>
      <td>{onOff(flag.enabled)}</td>
      <td>{flag.rolloutPct}%</td>
      <td>
        {on} on, {off} off
      </td>
    </tr>
  );
}

/** Every flag with its audience, switch, rollout and override counts (R21). */
export function FlagTable({ flags }: Readonly<{ flags: readonly FlagSummary[] }>) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <caption>Every feature flag; select one to change it, its overrides or see its history</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Audience</th>
            <th scope="col">Switch</th>
            <th scope="col">Rollout</th>
            <th scope="col">Overrides</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <FlagRow key={flag.key} flag={flag} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
