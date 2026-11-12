/**
 * Marks the shell's own overlays (the command palette and the mobile panel) so the shortcut guard can tell them from a
 * page's design-system dialog or menu. Spread `SHELL_OVERLAY_PROPS` onto their dialog.
 */
export const SHELL_OVERLAY = 'data-shell-overlay';

export const SHELL_OVERLAY_PROPS: Readonly<Record<typeof SHELL_OVERLAY, ''>> = { [SHELL_OVERLAY]: '' };
