import { css, type CSSResult } from 'lit';

/*
 * Like the rest of the header, every value reads the B.C. design token with the token's own value as the fallback
 * (tokens.test.ts keeps them in sync).
 */

/** The bell, its badge and the visually hidden text used by the live region and unread rows. */
export const bellStyles: CSSResult = css`
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .bell-trigger {
    position: relative;
    font-size: var(--typography-font-size-large-body, 1.125rem);
  }

  /* Over the bell's top-right corner, in B.C. blue so white text keeps its contrast. */
  .badge {
    position: absolute;
    top: 0;
    right: 0;
    box-sizing: border-box;
    min-width: 1.25rem;
    padding: 0 var(--layout-padding-xsmall, 0.25rem);
    border-radius: var(--layout-border-radius-circular, 9999px);
    background-color: var(--surface-color-primary-default, #013366);
    color: var(--typography-color-primary-invert, #ffffff);
    font-size: var(--typography-font-size-label, 0.75rem);
    font-weight: var(--typography-font-weights-bold, 700);
    line-height: var(--typography-line-heights-xxxdense, 1.125rem);
    text-align: center;
  }

  .bar-actions {
    display: flex;
    align-items: center;
    gap: var(--layout-margin-xsmall, 0.25rem);
    margin-inline-start: auto;
  }
`;

/** The popover: a panel right-aligned under the bell whose list scrolls between its header row and "View all". */
export const popoverStyles: CSSResult = css`
  .notifications {
    position: relative;
    display: inline-flex;
  }

  /* Narrow screens: the panel hangs from the header itself, inside its gutters, so it never leaves the viewport. */
  .notifications.collapsed {
    position: static;
  }

  .notifications-panel {
    position: absolute;
    top: calc(100% + var(--layout-margin-xsmall, 0.25rem));
    right: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: 24rem;
    max-height: min(32rem, calc(100dvh - 65px - 2 * var(--layout-margin-small, 0.5rem)));
    border: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
    border-radius: var(--layout-border-radius-medium, 4px);
    background-color: var(--surface-color-menus-default, #ffffff);
    box-shadow: 0 4px 8px rgb(0 0 0 / 15%);
  }

  .notifications.collapsed .notifications-panel {
    right: var(--layout-padding-medium, 1rem);
    max-width: calc(100% - 2 * var(--layout-padding-medium, 1rem));
  }

  .notifications-header {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--layout-margin-xsmall, 0.25rem);
    padding: var(--layout-padding-xsmall, 0.25rem) var(--layout-padding-small, 0.5rem);
    border-bottom: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
  }

  .notifications-header h2 {
    margin: 0;
    padding-inline-start: var(--layout-padding-small, 0.5rem);
    color: var(--typography-color-primary, #2d2d2d);
    font-size: var(--typography-font-size-body, 1rem);
    font-weight: var(--typography-font-weights-bold, 700);
  }

  .notifications-panel .button {
    min-height: 44px;
    color: var(--typography-color-link, #255a90);
  }

  .notifications-panel .button[aria-disabled='true'] {
    color: var(--typography-color-disabled, #9f9d9c);
    cursor: default;
  }

  .notifications-panel .button[aria-disabled='true']:hover {
    background-color: transparent;
  }

  .inline-error {
    flex-basis: 100%;
    padding: 0 var(--layout-padding-small, 0.5rem) var(--layout-padding-xsmall, 0.25rem);
    color: var(--typography-color-danger, #ce3e39);
    font-size: var(--typography-font-size-small-body, 0.875rem);
    text-align: end;
  }

  .notification-list {
    flex: 1 1 auto;
    margin: 0;
    padding: var(--layout-padding-xsmall, 0.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }

  .notification-item {
    display: flex;
    gap: var(--layout-margin-small, 0.5rem);
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    padding: var(--layout-padding-small, 0.5rem);
    border: none;
    border-radius: var(--layout-border-radius-small, 2px);
    background-color: transparent;
    color: var(--typography-color-primary, #2d2d2d);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .notification-item:hover {
    background-color: var(--surface-color-menus-hover, #edebe9);
  }

  .notification-item:focus-visible {
    outline: var(--layout-border-width-medium, 2px) solid var(--surface-color-border-active, #2e5dd7);
    outline-offset: calc(-1 * var(--layout-border-width-medium, 2px));
  }

  /* Unread rows carry the dot and bold title plus hidden "Unread" text, so the state isn't colour alone. */
  .unread-dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: var(--layout-margin-small, 0.5rem);
    border-radius: var(--layout-border-radius-circular, 9999px);
    background-color: var(--surface-color-primary-default, #013366);
  }

  .notification-item.read {
    padding-inline-start: calc(1rem + var(--layout-padding-small, 0.5rem));
  }

  .item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .item-title {
    font-weight: var(--typography-font-weights-regular, 400);
  }

  .notification-item:not(.read) .item-title {
    font-weight: var(--typography-font-weights-bold, 700);
  }

  .item-excerpt,
  .item-time {
    color: var(--typography-color-secondary, #474543);
    font-size: var(--typography-font-size-small-body, 0.875rem);
  }

  .item-excerpt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-state {
    flex: 1 1 auto;
    margin: 0;
    padding: var(--layout-padding-medium, 1rem);
    color: var(--typography-color-secondary, #474543);
    outline: none;
  }

  .notifications-footer {
    display: flex;
    flex: none;
    justify-content: center;
    border-top: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
  }

  .notifications-footer .nav-link {
    justify-content: center;
    width: 100%;
    min-height: 44px;
  }
`;
