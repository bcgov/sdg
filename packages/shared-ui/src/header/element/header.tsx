import type { JSX } from 'preact';

import { BcLogo } from './logo.js';
import { Nav } from './nav.js';

export interface HeaderProps {
  siteTitle: string;
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

export function Header({ siteTitle, ...auth }: HeaderProps): JSX.Element {
  return (
    <header class="header">
      <div class="row utility" data-part="utility">
        <Auth {...auth} />
      </div>
      <div class="row main" data-part="main">
        <BcLogo />
        <span class="separator" data-part="separator" aria-hidden="true" />
        <span class="title" data-part="title">
          {siteTitle}
        </span>
        <Nav />
      </div>
    </header>
  );
}
