import { Footer } from '@repo/design-system/components/footer';
import { Outlet } from '@tanstack/react-router';

import { Devtools } from '../devtools';
import { SiteHeader } from '../site-header';

import styles from './root-layout.module.css';

export function RootLayout() {
  return (
    <>
      <div className={styles.layout}>
        {/* The shared header has no skip link, so the app keeps its own, first in the tab order. */}
        <a className={styles.skipLink} href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main-content" className={styles.main} tabIndex={-1}>
          <div className={styles.container}>
            <Outlet />
          </div>
        </main>
        <Footer />
      </div>
      <Devtools />
    </>
  );
}
