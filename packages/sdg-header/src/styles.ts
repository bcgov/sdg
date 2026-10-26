import { css, type CSSResult } from 'lit';

import { bcEmblemViewBox, bcLogoViewBox } from './logo.js';

/*
 * Every value reads the B.C. design token with the token's own value as the fallback (tokens.test.ts keeps them in
 * sync), so the header looks right on pages that don't load @bcgov/design-tokens. The font is inherited.
 */

/** The upstream logo's rendered width; the emblem crop takes the same scale. */
const logoWidth = 129;
const viewBoxWidth = (viewBox: string): number => Number(viewBox.split(' ')[2]);
const emblemWidth = Math.round(((logoWidth * viewBoxWidth(bcEmblemViewBox)) / viewBoxWidth(bcLogoViewBox)) * 100) / 100;

/** The B.C. header shell (after the upstream `.bcds-header` styles) and its skip links. */
export const shellStyles: CSSResult = css`
  :host {
    display: block;
    position: relative;
  }

  [hidden] {
    display: none !important;
  }

  .bcds-header {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-around;
    position: relative;
    width: 100%;
    min-height: 65px;
    padding: 0 var(--layout-padding-medium, 1rem);
    border-bottom: var(--layout-border-width-small, 1px) solid var(--surface-color-border-default, #d8d8d8);
    background-color: var(--surface-color-forms-default, #ffffff);
  }

  .bcds-header--container {
    flex-grow: 1;
    display: flex;
    align-items: center;
    gap: var(--layout-padding-medium, 1rem);
    max-width: 1100px;
  }

  .logo {
    display: inline-flex;
  }

  .logo svg {
    width: ${logoWidth}px;
    min-width: ${logoWidth}px;
  }

  /* The logo cropped to its emblem (collapsed layout), drawn at the full logo's scale so the emblem keeps its size. */
  .logo svg.emblem {
    width: ${emblemWidth}px;
    min-width: ${emblemWidth}px;
    overflow: hidden;
  }

  .bcds-header--line {
    width: 1px;
    height: 32px;
    background-color: var(--surface-color-border-default, #d8d8d8);
  }

  .bcds-header--title {
    color: var(--typography-color-primary, #2d2d2d);
    font-size: var(--typography-font-size-h4, 1.5rem);
    font-weight: var(--typography-font-weights-bold, 700);
    line-height: var(--typography-line-heights-sparse, 2.25rem);
    -webkit-user-select: none;
    user-select: none;
  }

  .bcds-header--skiplinks {
    position: absolute;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Off-screen until focused, then shown over the logo at the container's left edge. */
  .bcds-header--skiplinks a {
    position: absolute;
    box-sizing: border-box;
    margin-top: -17.5px;
    margin-left: -100000px;
    padding: var(--layout-padding-xsmall, 0.25rem) var(--layout-padding-medium, 1rem);
    background-color: var(--surface-color-forms-default, #ffffff);
    color: var(--typography-color-link, #255a90);
    font-size: var(--typography-font-size-body, 1rem);
    white-space: nowrap;
  }

  .bcds-header--skiplinks a:focus {
    margin-left: 0;
  }

  .icon {
    width: 1em;
    height: 1em;
    flex: none;
  }
`;

/** Nav items, the Sign in link, the avatar and the plain (tertiary) buttons. */
export const controlStyles: CSSResult = css`
  .nav-area {
    display: flex;
    align-items: center;
    gap: var(--layout-margin-small, 0.5rem);
    margin-inline-start: auto;
  }

  .nav-list {
    display: flex;
    align-items: center;
    gap: var(--layout-margin-small, 0.5rem);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* B.C. Primary Blue, so nav items read as navigation against the body text. */
  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: var(--layout-margin-xsmall, 0.25rem);
    padding: var(--layout-padding-xsmall, 0.25rem) var(--layout-padding-small, 0.5rem);
    border-radius: var(--layout-border-radius-small, 2px);
    color: var(--surface-color-primary-default, #013366);
    font-size: var(--typography-font-size-body, 1rem);
    font-weight: var(--typography-font-weights-regular, 400);
    text-decoration: none;
  }

  .nav-link:hover {
    text-decoration: underline;
    text-underline-offset: var(--layout-margin-hair, 0.125rem);
  }

  .nav-link[aria-current='page'] {
    font-weight: var(--typography-font-weights-bold, 700);
  }

  .nav-link:focus-visible,
  .button:focus-visible,
  .logo:focus-visible {
    outline: var(--layout-border-width-medium, 2px) solid var(--surface-color-border-active, #2e5dd7);
    outline-offset: var(--layout-margin-hair, 0.125rem);
  }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--layout-margin-small, 0.5rem);
    min-height: 40px;
    padding: var(--layout-padding-small, 0.5rem) var(--layout-padding-medium, 1rem);
    border: none;
    border-radius: var(--layout-border-radius-medium, 4px);
    background-color: transparent;
    color: var(--typography-color-primary, #2d2d2d);
    font: inherit;
    cursor: pointer;
  }

  .button:hover {
    background-color: var(--surface-color-secondary-hover, #edebe9);
  }

  .button.icon-only {
    min-width: 40px;
    padding: var(--layout-padding-small, 0.5rem);
  }

  .danger {
    color: var(--typography-color-danger, #ce3e39);
  }

  .avatar {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: var(--layout-border-radius-circular, 9999px);
    background-color: var(--surface-color-primary-default, #013366);
    color: var(--typography-color-primary-invert, #ffffff);
    font-weight: var(--typography-font-weights-bold, 700);
    line-height: 1;
    user-select: none;
  }

  .avatar.small {
    width: 32px;
    height: 32px;
    font-size: var(--typography-font-size-label, 0.75rem);
  }

  .avatar.medium {
    width: 40px;
    height: 40px;
    font-size: var(--typography-font-size-small-body, 0.875rem);
  }

  .avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: var(--layout-margin-small, 0.5rem);
    min-width: 0;
    padding: var(--layout-padding-xsmall, 0.25rem) var(--layout-padding-small, 0.5rem);
  }

  .identity {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--typography-color-primary, #2d2d2d);
    font-size: var(--typography-font-size-body, 1rem);
    font-weight: var(--typography-font-weights-bold, 700);
  }

  .email {
    overflow: hidden;
    color: var(--typography-color-secondary, #474543);
    font-size: var(--typography-font-size-small-body, 0.875rem);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
