import { useCallback, useState, type JSX } from 'react';

import styles from './avatar.module.css';

export interface AvatarProps {
  /** Used for the initials and the accessible name. */
  name: string;
  /** Image URL; falls back to the initials if it fails to load. */
  src?: string | null;
  /** 32 / 40 / 56 px. Defaults to `medium`. */
  size?: 'small' | 'medium' | 'large';
  /** Hides the avatar from assistive technology, e.g. when the name is shown next to it. */
  decorative?: boolean;
  className?: string;
}

const firstLetter = (word: string): string => Array.from(word)[0] ?? '';

/** First letter of the first and last words, uppercased; `?` for a blank name. */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words.at(-1) : undefined;
  return (firstLetter(first) + (last === undefined ? '' : firstLetter(last))).toLocaleUpperCase();
}

export function Avatar({ name, src, size = 'medium', decorative = false, className }: AvatarProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const handleError = useCallback(() => setFailedSrc(src ?? null), [src]);
  const classes = [styles['avatar'], styles[size], className].filter(Boolean).join(' ');
  const a11y = decorative ? { 'aria-hidden': true } : {};

  if (src && src !== failedSrc) {
    return (
      <span className={classes} {...a11y}>
        <img className={styles['image']} src={src} alt={decorative ? '' : name} onError={handleError} />
      </span>
    );
  }

  return (
    <span className={classes} {...(decorative ? a11y : { role: 'img', 'aria-label': name })}>
      <span className={styles['initials']} aria-hidden="true">
        {getInitials(name)}
      </span>
    </span>
  );
}
