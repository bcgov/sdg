/** What every template sees beside the sender's data, which cannot override it (KTD10). */
export interface NotificationVariables {
  notification: { id: string };
  /** True only for a user recipient: address and system recipients have no inbox. */
  recipient: { hasInbox: boolean };
}

/** Typed against the interface, so adding or removing a variable fails to compile until this lists it. */
const variableNames: Record<keyof NotificationVariables, true> = { notification: true, recipient: true };

/** The variables' names, which a data contract cannot use as top-level properties. */
export const NOTIFICATION_VARIABLE_NAMES: readonly string[] = Object.keys(variableNames);
