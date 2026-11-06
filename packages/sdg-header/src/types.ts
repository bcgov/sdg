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

/** One of the user's notifications, as the notifications source lists it. */
export interface InboxItem {
  /** The inbox item's id, used to mark it read. */
  id: string;
  /** The notification's id, used in links to the host's notification page. */
  notificationId: string;
  title: string | null;
  /** Plain text from the start of the body. */
  excerpt: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Passed to `accessTokenFn`: `background` is true for requests that are not a user action. */
export interface AccessTokenRequest {
  background: boolean;
}

/**
 * Supplies the bearer token for direct mode. Return `null` when no token is available without the user (for example,
 * when `background` is true and refreshing would extend the sign-in): the header then waits for the user's next pointer
 * or key event and asks again with `background: false`.
 */
export type AccessTokenFn = (request: AccessTokenRequest) => string | null | Promise<string | null>;
