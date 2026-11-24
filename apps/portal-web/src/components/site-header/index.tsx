import { loadSdgHeader, SdgHeader, type SdgSettingsEvent } from '@repo/shared-ui/header/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useHeaderAuth } from '../auth-control';

// Home is current only on "/" itself, not on every path under it.
const exactMatch = { exact: true } as const;

/** Starts loading `<sdg-header>` before React mounts; never rejects (the loader logs failures itself). */
export async function startHeader(): Promise<void> {
  try {
    await loadSdgHeader();
  } catch {
    // The loader logs a failure with context; the page keeps the pre-load band and shows no header.
  }
}

/**
 * The edge-served `<sdg-header>` wired to the router and the BFF session. The nav items are router links, so they
 * navigate client-side; an active `Link` sets `aria-current="page"` itself, which the header styles as selected.
 * The user menu's Account Settings is the header's own link to this site's /account-settings, so the router takes it over too.
 */
export function SiteHeader() {
  const auth = useHeaderAuth();
  const navigate = useNavigate();
  const onSettings = useCallback(
    (event: SdgSettingsEvent) => {
      event.preventDefault();
      void navigate({ to: '/account-settings' });
    },
    [navigate],
  );

  return (
    <SdgHeader {...auth} onSettings={onSettings}>
      <Link slot="nav" to="/" activeOptions={exactMatch}>
        Home
      </Link>
      <Link slot="nav" to="/services">
        Services
      </Link>
      <Link slot="nav" to="/help">
        Help
      </Link>
      <Link slot="nav" to="/contact-us">
        Contact us
      </Link>
    </SdgHeader>
  );
}
