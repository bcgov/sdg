import { Link, type LinkProps } from '@repo/design-system/components/link';
import { withReturnTo } from '@repo/shared-ui/header/react';
import { useLocation } from '@tanstack/react-router';

export type ExternalServiceLinkProps = Omit<LinkProps, 'href'> & {
  /** The other site's page: an absolute URL. */
  href: string;
};

/**
 * A link to another government site that uses the SDG header. It carries `return-to`, this page's path, search and
 * hash, so that site's header shows "Back to SDG" leading straight back here (`packages/shared-ui/README.md`).
 */
export function ExternalServiceLink({ href, ...props }: Readonly<ExternalServiceLinkProps>) {
  const returnPath = useLocation({ select: (location) => location.href });
  return <Link {...props} href={withReturnTo(href, returnPath)} />;
}
