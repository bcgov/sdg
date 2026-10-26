import { Link } from '@bcgov/design-system-react-components';
import type { ComponentProps, JSX } from 'react';

import styles from './nav-link.module.css';

type UpstreamLinkProps = ComponentProps<typeof Link>;

export type NavLinkProps = Omit<UpstreamLinkProps, 'isButton' | 'buttonVariant' | 'isUnstyled' | 'danger' | 'size'>;

/** A header/navigation item: plain text that underlines on hover, unlike the underlined body-text `Link`. */
export function NavLink({ className, ...props }: NavLinkProps): JSX.Element {
  return <Link {...props} isUnstyled className={[styles['navLink'], className].filter(Boolean).join(' ')} />;
}
