import type { JSX } from 'preact';

import { BcLogo } from './logo.js';
import { Nav } from './nav.js';

export interface HeaderProps {
  siteTitle: string;
  /** Full-width contents instead of the responsive max-width container. */
  fluid: boolean;
  userName: string;
  loginHref: string;
  /** The Log In link's click; decides whether to dispatch `sdg-login`. */
  onLoginClick: (event: MouseEvent) => void;
  onLogoutClick: () => void;
}

type AuthProps = Pick<HeaderProps, 'userName' | 'loginHref' | 'onLoginClick' | 'onLogoutClick'>;

// Signed in (a user name), signed out (a login-href only), or unknown (neither: the host is still checking the
// session), which renders no control so nobody clicks Log In for a session that turns out to exist (R3, R4).
function Auth({ userName, loginHref, onLoginClick, onLogoutClick }: AuthProps): JSX.Element | null {
  if (userName) {
    return (
      <>
        <span class="user-name">{userName}</span>
        <button type="button" class="button button-secondary" onClick={onLogoutClick}>
          Log Out
        </button>
      </>
    );
  }
  if (loginHref) {
    return (
      <a class="button button-primary" href={loginHref} onClick={onLoginClick}>
        Log In
      </a>
    );
  }
  return null;
}

// Each row keeps its full-width background and border; its contents sit in a container that is capped at the
// Bootstrap 5 container widths, or spans the full width when the host sets `fluid`.
export function Header({ siteTitle, fluid, ...auth }: HeaderProps): JSX.Element {
  const container = fluid ? 'container container-fluid' : 'container';
  return (
    <header class="header">
      <div class="row utility" data-part="utility">
        <div class={container} data-part="container">
          <Auth {...auth} />
        </div>
      </div>
      <div class="row main" data-part="main">
        <div class={container} data-part="container">
          <BcLogo />
          <span class="separator" data-part="separator" aria-hidden="true" />
          <span class="title" data-part="title">
            {siteTitle}
          </span>
          <Nav />
        </div>
      </div>
    </header>
  );
}
