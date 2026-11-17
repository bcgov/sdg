import { SdgHeader } from '@repo/shared-ui/header/react';
import { Link } from '@tanstack/react-router';

import { useHeaderAuth } from '../auth-control';

// Home is current only on "/" itself, not on every path under it.
const exactMatch = { exact: true } as const;

/**
 * The edge-served `<sdg-header>` wired to the router and the BFF session. The nav items are router links, so they
 * navigate client-side; an active `Link` sets `aria-current="page"` itself, which the header styles as selected.
 */
export function SiteHeader() {
  const auth = useHeaderAuth();

  return (
    <SdgHeader siteTitle="SDG" {...auth}>
      <Link slot="nav" to="/" activeOptions={exactMatch}>
        Home
      </Link>
      <Link slot="nav" to="/help">
        Help
      </Link>
    </SdgHeader>
  );
}
