import { html, type TemplateResult } from 'lit';

import type { HeaderUser } from './types.js';

const firstLetter = (word: string): string => Array.from(word)[0] ?? '';

/** First letter of the first and last words, uppercased; `?` for a blank name. */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words.at(-1) : undefined;
  return (firstLetter(first) + (last === undefined ? '' : firstLetter(last))).toLocaleUpperCase();
}

export interface AvatarOptions {
  /** 32px (`small`) or 40px (`medium`). */
  size: 'small' | 'medium';
  /** The image URL that already failed to load; the avatar shows initials instead of retrying it. */
  failedSrc: string | null;
  onImageError: (src: string) => void;
}

/** Decorative avatar: the user's image, or their initials when there is none or it fails to load. */
export function renderAvatar(user: HeaderUser, { size, failedSrc, onImageError }: AvatarOptions): TemplateResult {
  const src = user.avatarSrc;
  if (src && src !== failedSrc) {
    return html`<span class="avatar ${size}" aria-hidden="true">
      <img class="avatar-image" src=${src} alt="" @error=${() => onImageError(src)} />
    </span>`;
  }
  return html`<span class="avatar ${size}" aria-hidden="true">${getInitials(user.name)}</span>`;
}
