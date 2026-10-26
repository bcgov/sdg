/** A link shown only while focused, e.g. "Skip to main content" → `#main-content`. */
export interface SkipLink {
  label: string;
  href: string;
}

/** A header navigation item. `current` marks the page the user is on (`aria-current="page"`, bold). */
export interface NavItem {
  label: string;
  href: string;
  current?: boolean;
}

/** The signed-in user shown in the account menu. */
export interface HeaderUser {
  name: string;
  email?: string | null;
  avatarSrc?: string | null;
}
