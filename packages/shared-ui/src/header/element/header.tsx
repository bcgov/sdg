import { faArrowRightToBracket } from '@fortawesome/free-solid-svg-icons';
import type { JSX } from 'preact';

import { Icon } from './icon.js';
import { BcLogo } from './logo.js';
import { Nav } from './nav.js';
import { UserMenu } from './user-menu.js';

export interface HeaderProps {
  siteTitle: string;
  /** Full-width contents instead of the responsive max-width container. */
  fluid: boolean;
  userName: string;
  loginHref: string;
  /** SDG's settings page, which the user menu links to. */
  settingsHref: string;
  /** The Log In link's click; decides whether to dispatch `sdg-login`. */
  onLoginClick: (event: MouseEvent) => void;
  /** The Account Settings link's click; decides whether to dispatch `sdg-settings`. */
  onSettingsClick: (event: MouseEvent) => void;
  onLogoutClick: () => void;
}

type AuthProps = Omit<HeaderProps, 'siteTitle' | 'fluid'>;

// Signed in (a user name), signed out (a login-href only), or unknown (neither: the host is still checking the
// session), which renders no control so nobody clicks Log In for a session that turns out to exist (R3, R4).
function Auth({ userName, loginHref, onLoginClick, ...menu }: Readonly<AuthProps>): JSX.Element | null {
  if (userName) return <UserMenu userName={userName} {...menu} />;
  if (loginHref) {
    return (
      <a className="button button-secondary button-icon button-collapsible" href={loginHref} onClick={onLoginClick}>
        <Icon icon={faArrowRightToBracket} />
        <span className="button-label">Log In</span>
      </a>
    );
  }
  return null;
}

// Each row keeps its full-width background and border; its contents sit in a container that is capped at the
// Bootstrap 5 container widths, or spans the full width when the host sets `fluid`. "SDG" is fixed; the host's own
// title follows it after a divider on the main row, and on small screens moves to a row of its own under the header.
export function Header({ siteTitle, fluid, ...auth }: Readonly<HeaderProps>): JSX.Element {
  const container = fluid ? 'container container-fluid' : 'container';
  return (
    <header className="header">
      <div className="row utility" data-part="utility">
        <div className={container} data-part="container">
          <Auth {...auth} />
        </div>
      </div>
      <div className="row main" data-part="main">
        <div className={container} data-part="container">
          <span className="lockup" data-part="lockup">
            <BcLogo />
            <span className="brand" data-part="brand">
              SDG
            </span>
          </span>
          {siteTitle && (
            <>
              <span className="separator" data-part="separator" aria-hidden="true" />
              <span className="title" data-part="title">
                {siteTitle}
              </span>
            </>
          )}
          <Nav />
        </div>
      </div>
      {siteTitle && (
        <div className="row title-row" data-part="title-row">
          <div className={container} data-part="container">
            <span className="title" data-part="title-row-title">
              {siteTitle}
            </span>
          </div>
        </div>
      )}
    </header>
  );
}
