import { Link, type LinkProps } from '@repo/design-system/components/link';

export type NewTabLinkProps = Omit<LinkProps, 'href' | 'target' | 'rel' | 'ariaLabel' | 'children'> & {
  href: string;
  children: string;
};

/** A link to another site, opened in a new tab; its accessible name says so. */
export function NewTabLink({ href, children, ...props }: Readonly<NewTabLinkProps>) {
  return (
    <Link
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      ariaLabel={`${children} (opens in a new tab)`}
    >
      {children}
    </Link>
  );
}
