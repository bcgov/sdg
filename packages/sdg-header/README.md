# @repo/sdg-header

`<sdg-header>`: the B.C. government header as a framework-free web component (Lit, Shadow DOM). It has the logo, a title (`SDG` by default), skip links, nav items, an optional notifications bell and an account control. Below 768px the nav and account collapse behind a hamburger panel, and the bell stays in the bar beside it. Every input is optional.

## Use it

### From a registry (bundled apps)

React 19 apps use the typed `<SdgHeader>` component from `@repo/sdg-header/react`. Importing it registers the element, and its props are the element's API in camelCase. React is an optional peer dependency, needed only for this entry. `lit` and `@fortawesome/free-solid-svg-icons` are regular dependencies, so your bundler dedupes them.

The component doesn't depend on any router. You connect your router through two props:

- **`navigateFn`:** plain clicks on nav items and the logo call it with the link's `href` instead of loading the page. Ctrl/Cmd/Shift/middle clicks still open new tabs as usual.
- **`navItems[].current`:** compute it from your router's current pathname. The header marks that item with `aria-current="page"`, and it stays right for back/forward and in-page links too.

Each example below is a `SiteHeader` you render once in your root layout, above `<main id="main-content" tabIndex={-1}>`. Pass `user`, `signInHref` and `signOutFn` from your session. Leave `user` and `signInHref` unset while the session is loading, so the header doesn't flash.

#### TanStack Router

```tsx
import { type HeaderUser, SdgHeader } from '@repo/sdg-header/react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

const skipLinks = [{ label: 'Skip to main content', href: '#main-content' }];
const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];

export interface SiteHeaderProps {
  user?: HeaderUser;
  signInHref?: string;
  signOutFn?: () => void;
}

export function SiteHeader({ user, signInHref, signOutFn }: SiteHeaderProps) {
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navItems = useMemo(
    () => navLinks.map(({ label, href }) => ({ label, href, current: href === pathname })),
    [pathname],
  );
  const navigateFn = useCallback((href: string) => void router.navigate({ href }), [router]);

  return (
    <SdgHeader
      skipLinks={skipLinks}
      navItems={navItems}
      navigateFn={navigateFn}
      user={user}
      signInHref={signInHref}
      signOutFn={signOutFn}
    />
  );
}
```

#### React Router (v7)

```tsx
import { type HeaderUser, SdgHeader } from '@repo/sdg-header/react';
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

const skipLinks = [{ label: 'Skip to main content', href: '#main-content' }];
const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];

export interface SiteHeaderProps {
  user?: HeaderUser;
  signInHref?: string;
  signOutFn?: () => void;
}

export function SiteHeader({ user, signInHref, signOutFn }: SiteHeaderProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navItems = useMemo(
    () => navLinks.map(({ label, href }) => ({ label, href, current: href === pathname })),
    [pathname],
  );
  const navigateFn = useCallback((href: string) => void navigate(href), [navigate]);

  return (
    <SdgHeader
      skipLinks={skipLinks}
      navItems={navItems}
      navigateFn={navigateFn}
      user={user}
      signInHref={signInHref}
      signOutFn={signOutFn}
    />
  );
}
```

#### Next.js (App Router)

The header uses router hooks and function props, so it has to be a client component (`'use client'`). The package is safe to import during server rendering: the server sends a plain `<sdg-header>` tag with its string attributes, and the element renders in the browser after hydration.

```tsx
'use client';

import { type HeaderUser, SdgHeader } from '@repo/sdg-header/react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';

const skipLinks = [{ label: 'Skip to main content', href: '#main-content' }];
const navLinks = [
  { label: 'Home', href: '/' },
  { label: 'Help', href: '/help' },
];

export interface SiteHeaderProps {
  user?: HeaderUser;
  signInHref?: string;
  signOutFn?: () => void;
}

export function SiteHeader({ user, signInHref, signOutFn }: SiteHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const navItems = useMemo(
    () => navLinks.map(({ label, href }) => ({ label, href, current: href === pathname })),
    [pathname],
  );
  const navigateFn = useCallback((href: string) => router.push(href), [router]);

  return (
    <SdgHeader
      skipLinks={skipLinks}
      navItems={navItems}
      navigateFn={navigateFn}
      user={user}
      signInHref={signInHref}
      signOutFn={signOutFn}
    />
  );
}
```

To avoid a layout shift before the element renders, reserve its height in your global CSS:

```css
sdg-header:not(:defined) {
  display: block;
  min-height: 65px;
}
```

#### Without React

Import the core to register the element (`import '@repo/sdg-header';`). Then set its properties directly, as in the CDN example below, and call your router from `navigateFn`. The core entry never imports React.

### From a CDN (plain HTML)

`dist/cdn/sdg-header.js` is one minified ES module with everything bundled:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/<package>@<version>/dist/cdn/sdg-header.js"></script>

<sdg-header header-title="My service" sign-in-href="/login"></sdg-header>
<script type="module">
  const header = document.querySelector('sdg-header');
  header.skipLinks = [{ label: 'Skip to main content', href: '#main-content' }];
  header.navItems = [
    { label: 'Home', href: '/', current: location.pathname === '/' },
    { label: 'Help', href: '/help', current: location.pathname === '/help' },
  ];
</script>
```

Every build registers the element only if `sdg-header` isn't defined yet, so loading more than one on a page is safe. `defineSdgHeader()` is exported if you want to register it yourself.

## API

| Attribute           | Property                 | Type                                                            | Default  | Notes                                                                                                                                        |
| ------------------- | ------------------------ | --------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `header-title`      | `headerTitle`            | `string`                                                        | `SDG`    | Text after the divider. An empty string hides the divider and title.                                                                         |
| `logo-href`         | `logoHref`               | `string`                                                        | `/`      | Where the logo links.                                                                                                                        |
| `sign-in-href`      | `signInHref`             | `string`                                                        | —        | Sign in link, shown when there is no `user`.                                                                                                 |
| `nav-label`         | `navLabel`               | `string`                                                        | `Main`   | Accessible name of the `<nav>`.                                                                                                              |
| `menu-label`        | `menuLabel`              | `string`                                                        | `Menu`   | Accessible name of the hamburger.                                                                                                            |
| —                   | `skipLinks`              | `{ label, href }[]`                                             | `[]`     | Hidden until focused.                                                                                                                        |
| —                   | `navItems`               | `{ label, href, current? }[]`                                   | `[]`     | `current` → `aria-current="page"`, bold.                                                                                                     |
| —                   | `user`                   | `{ name, email?, avatarSrc? } \| null`                          | `null`   | Avatar menu (wide) or profile (panel).                                                                                                       |
| —                   | `signOutFn`              | `() => void`                                                    | —        | Log out is shown only when set. Do the sign-out request here (e.g. a POST); a GET link would allow logout CSRF.                              |
| —                   | `navigateFn`             | `(href: string) => void`                                        | —        | Client-side routing: plain clicks on nav items and the logo call it instead of loading the page. Modified clicks don't.                      |
| `notifications-url` | `notificationsUrl`       | `string`                                                        | —        | The notifications source. With a `user`, the header shows the bell (see [Notifications](#notifications)).                                    |
| `inbox-href`        | `inboxHref`              | `string`                                                        | `/inbox` | Your inbox page: "View all" opens it, and each notification opens `${inboxHref}/${notificationId}` (through `navigateFn` when set).          |
| —                   | `accessTokenFn`          | `({ background }) => string \| null \| Promise<string \| null>` | —        | Direct mode: notification-api's bearer token. Unset, the header uses the relay with your cookies.                                            |
| —                   | `notificationsChangedFn` | `() => void`                                                    | —        | Called when the user's inbox changed (an arrival, a read here or elsewhere), so your inbox page can refetch without its own live connection. |

With no `user` and no `sign-in-href` there is no account control. Use that while the user is still loading, so the header doesn't flash.

## Notifications

Set `notifications-url` and the signed-in header shows a bell with the unread count (hidden at 0, `99+` above 99). It opens a popover with the newest 20 notifications, read and unread, "Mark all as read" and "View all". Activating a notification marks it read and opens `${inboxHref}/${notificationId}`. The header keeps one live connection per browser (shared between tabs), refetches when the inbox changes or the tab regains focus, and announces count changes in a polite live region. Without `notifications-url`, or with no user, the header renders as before and sends no requests. A source that answers 404 hides the bell; a 401 stops background requests until the signed-in state changes.

The source is one of two modes. Both use the same paths, relative to the URL, and in both every request that is not a user action (count and list loads, refetches, the stream) carries `sdg-background: 1`:

| Request                  | Answer                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `GET inbox/unread-count` | `{ unread }`                                                                              |
| `GET inbox?limit=20`     | `{ items: [{ id, notificationId, title, excerpt, readAt, createdAt }], nextCursor }`      |
| `POST inbox/{id}/read`   | the item, now read                                                                        |
| `POST inbox/read-all`    | any 2xx; marks read every item unread when it runs                                        |
| `GET inbox/stream`       | `text/event-stream`: `event: changed` when the inbox changed, keep-alive comments between |

- **Relay** (`accessTokenFn` unset): `notifications-url` is a path on your own origin, e.g. `/api/v1/notifications`, that forwards to notification-api's `/api/v1/me` with the user's session. Requests carry your cookies. The relay must not count a `sdg-background: 1` request as activity that extends the sign-in. It passes `inbox/stream` through as it arrives, flushing each chunk, with no total timeout: portal-api answers with notification-api's `content-type: text/event-stream` and `cache-control: no-cache, no-transform` plus `x-accel-buffering: no`. notification-api sends a `: keep-alive` comment every 15 seconds, so an idle timeout longer than that does not close it.
- **Direct** (`accessTokenFn` set): `notifications-url` is notification-api's own `/api/v1/me`, e.g. `https://<notification-api>/api/v1/me`. Your origin must be in its `CORS_ALLOWED_ORIGINS`, and your sign-in client's id (the token's `azp`) in its `RELAYING_CLIENT_IDS`. The header calls `accessTokenFn({ background })` before each request and sends `Authorization: Bearer <token>`, without cookies. Return `null` when you have no token without the user, e.g. for a background request whose refresh would extend the sign-in: the header then waits for the user's next pointer or key event and asks again with `background: false`.

## Styling

Colours, spacing and type come from the [B.C. design tokens](https://www.npmjs.com/package/@bcgov/design-tokens) as CSS custom properties. Each one falls back to the token's value, so the header looks right without the token stylesheet. The font is inherited, so load BC Sans on the page.

## Keeping up with upstream

This element is the only header implementation; nothing is generated from React. What it takes from upstream is checked in the tests:

- **Tokens:** `tokens.test.ts` fails when a `@bcgov/design-tokens` bump changes a value used as a fallback. Update the fallback in the styles.
- **Logo:** `logo.test.ts` fails when the logo in `@bcgov/design-system-react-components` changes. Run `pnpm --filter @repo/sdg-header generate:logo` and review the diff.
- **Header layout** (65px height, 1100px container, divider, skip links): review by hand on B.C. design-system releases.

## Build

```sh
pnpm --filter @repo/sdg-header build   # dist/index.js + dist/react/index.js + .d.ts (registry) and dist/cdn/sdg-header.js (CDN)
```

`dist/cdn/sdg-header.js` is about 71 kB (24 kB gzipped) with the notifications bell; `package.test.ts` keeps it under 75,000 bytes and the React entry under 3,000. Raise those ceilings deliberately, and update this line, when a change needs more.

To publish, give the package a publishable name and remove `"private": true`.
