# @repo/shared-ui

Shared UI served to any website from the edge. Today that is one component: the SDG header, a `<sdg-header>` custom
element built with Preact.

Every site loads the header the same way, with one loader script tag pinned with Subresource Integrity
(`integrity`), so every site runs the same release. The loader never changes within a major. It fetches a release
manifest signed by this team's CI, checks it, and loads that release's header bundle with the bundle's hash as its
`integrity`. Visitors get a new release (or a rolled-back one) on their next page load, and nobody redeploys to pick it
up.

| Environment | Loader URL                                                 | Loader `integrity`                                                        |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| PROD        | `https://<portal-host>/shared-ui/header/v1/loader.js`      | `sha384-7h+W3F+UrCzZ0jOAtulVyF8Tchx5vdast7PH7/dDoD2rjPLjHQ2a2T/SgMgGwRh8` |
| TEST        | `https://<test-portal-host>/shared-ui/header/v1/loader.js` | `sha384-gy7DZvVyoCBeHGEwI5mlqsC4xMtvIzicSFCvqgOntHN5yQVEiCnU/aa91laMuyWc` |
| PR preview  | `https://<pr-portal-host>/shared-ui/header/v1/loader.js`   | `sha384-EtvdKzJlc0HCxCgq996747aIkRDJug6AwBu0uPvGHXULriPd0871iMvD6QLpQuaF` |

`<portal-host>` is the portal's host in that environment. Each environment's loader trusts only that environment's
signing keys, so its `integrity` differs: use the value from its row, and point your TEST site at the TEST loader so you
see releases there before PROD.

A value containing `PLACEHOLDER` marks an environment whose loader has not been generated yet: a tag carrying it loads
nothing. Once the loader is generated, its value is the keyset's `integrity` in
[`loaders.lock.json`](loaders.lock.json) (`prod`, `test` or `pr`), and this table carries it.

## Adding the header to a site

Any site, React or not, needs four things: CSP allowances, a pre-load CSS rule, the loader tag and the markup. Your
site must be served over HTTPS: the loader checks signatures with the browser's Web Crypto, which only secure pages
have.

### 1. Allow the header's host in your CSP

Add the portal host to `script-src` (the loader and the header bundle) and to `connect-src` (the loader fetches the
signed manifest from it):

```
Content-Security-Policy: script-src 'self' https://<portal-host>; connect-src 'self' https://<portal-host>
```

Those are the only CSP changes. The header injects no `<style>` elements (its styles are a constructed stylesheet,
which `style-src` does not govern), loads no fonts and draws its logo as inline SVG, so `style-src`, `font-src` and
`img-src` need nothing.

### 2. Add the pre-load CSS rule

Until the header has defined the element, this rule reserves the header's full height and hides the raw nav links, so
nothing on the page moves when the header appears. The header is 104px tall, or 142px on screens narrower than 576px
when you set `site-title` (the title moves to its own row there). Copy it into your own stylesheet:

```css
sdg-header:not(:defined) {
  display: block;
  height: 104px;
  background: linear-gradient(
    to bottom,
    var(--surface-color-background-light-gray, #faf9f8) 0 47px,
    var(--surface-color-border-default, #d8d8d8) 47px 48px,
    var(--surface-color-background-white, #ffffff) 48px 103px,
    var(--surface-color-border-default, #d8d8d8) 103px 104px
  );
}

@media (max-width: 575.98px) {
  sdg-header[site-title]:not([site-title='']):not(:defined) {
    height: 142px;
    background: linear-gradient(
      to bottom,
      var(--surface-color-background-light-gray, #faf9f8) 0 47px,
      var(--surface-color-border-default, #d8d8d8) 47px 48px,
      var(--surface-color-background-white, #ffffff) 48px 103px,
      var(--surface-color-border-default, #d8d8d8) 103px 104px,
      var(--surface-color-background-white, #ffffff) 104px 141px,
      var(--surface-color-border-default, #d8d8d8) 141px 142px
    );
  }
}

sdg-header:not(:defined) > * {
  display: none;
}
```

This rule stays valid for the whole of v1: changing what it targets or the header's height is a new major.

### 3. Add the loader tag

```html
<script
  src="https://<portal-host>/shared-ui/header/v1/loader.js"
  integrity="sha384-7h+W3F+UrCzZ0jOAtulVyF8Tchx5vdast7PH7/dDoD2rjPLjHQ2a2T/SgMgGwRh8"
  crossorigin="anonymous"
  async
></script>
```

Use the URL and `integrity` from your environment's row in the table above. `crossorigin="anonymous"` is required: a
browser checks `integrity` on a script from another origin only when it is fetched with CORS. The header's files answer
with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`, never accept credentials, and
work under `Cross-Origin-Embedder-Policy: require-corp`. It is a classic script: it needs no `type="module"`.

### 4. Add the markup

```html
<sdg-header site-title="My Service" login-href="/login">
  <a slot="nav" href="/">Home</a>
  <a slot="nav" href="/applications" aria-current="page">Applications</a>
  <a slot="nav" href="/help">Help</a>
</sdg-header>
```

Then handle the logout event (see [Events](#events)) if visitors can sign in.

## Attributes

| Attribute    | Meaning                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site-title` | Your site's title, shown after "SDG" and a divider, cut off with an ellipsis when it doesn't fit. Below 576px it moves to its own row under the header. |
| `user-name`  | The signed-in visitor's name. When set, the header shows a menu button with the name, opening Account Settings and Log Out.                             |
| `login-href` | Where Log In links to. Shown only when `user-name` is not set. Must be an http(s) URL you control, never page input.                                    |
| `fluid`      | Boolean: present (any value) makes the contents full width. Without it, see below.                                                                      |

The header shows one of three auth states:

- **Signed out:** `login-href` set, no `user-name`. The grey row shows Log In.
- **Signed in:** `user-name` set. The grey row shows a menu button with the name; it opens Account Settings and Log Out.
  Account Settings always links to the SDG account settings page: the header reads SDG's address from where its own script was
  served, so it points at the same environment (PR, test or production) as the loader you load.
- **Unknown:** neither set, for example while your site is still checking the session. The grey row keeps its
  height and shows no control, so nothing moves when you set one of them.

Change the attributes at any time; the header re-renders.

### Back to SDG

When a visitor reaches your site from SDG, the grey row shows "← Back to SDG" at its start, linking to the SDG page
they came from. Your site does nothing: SDG adds `return-to` (the SDG page's path) to its links to your site, and the
header reads it. The header remembers that page in your site's session storage, so the link stays as the visitor
moves around your site and goes away when they close the tab. A visitor who follows an SDG link without `return-to`
gets a link to SDG's home page instead.

The link only ever points at the SDG that served the header's script: `return-to` must be a path on that SDG, so a
crafted link cannot send visitors elsewhere. `return-to` stays in your page's address; the header never changes your
URL. If you redirect a visitor's first page (for example to sign them in), keep `return-to` on the page they land on,
or the header falls back to the referrer or shows no link.

### Width

The grey and white rows always span the page. Their contents (Log In, logo, SDG, your title, nav) sit in a centered container
that stops at 1100px and shrinks with the screen below that.

Add `fluid` to make the contents full width at every size:

```html
<sdg-header site-title="My Service" fluid></sdg-header>
```

### Small screens

Below 576px the logo shrinks to the B.C. sun and mountains, and your `site-title` (if set) leaves the main row for a
38px row of its own under the header, so the header is 142px tall there instead of 104px. The pre-load rule above
reserves the right height either way.

## Nav items

Nav items are your own links, placed in the `nav` slot with `slot="nav"`. The header never navigates by itself, so
plain `<a href>` links and client-side router links (for example TanStack Router's `Link`) both work.

Mark the current page with `aria-current="page"`. The header styles that link as selected (bold, light blue
background, 2px bottom border) and your CSS cannot override that look. Your other CSS rules aimed at links inside the
header (spacing, colour, underline) still apply to them, because they stay your elements. On narrow screens the links
move behind a menu button.

## Events

All events bubble, cross the shadow boundary (`composed`) and are dispatched on the `<sdg-header>` element.

| Event          | When                                    | What your site does                                                                                                                                                                                                    |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdg-login`    | A plain left click on Log In.           | Nothing, and the link goes to `login-href`. Or call `event.preventDefault()` to stop the navigation and handle sign-in yourself. Modified clicks (new tab, middle click) are left to the browser and dispatch nothing. |
| `sdg-settings` | A plain left click on Account Settings. | Nothing, and the link goes to the SDG account settings page. On SDG itself, call `event.preventDefault()` to route there client-side. Modified clicks are left to the browser and dispatch nothing.                    |
| `sdg-logout`   | A click on Log Out.                     | **Required:** sign the visitor out, for example with a POST to your session endpoint. The header does nothing else: Log Out is a button with no URL, so no other site can link a visitor into a sign-out.              |

```js
const header = document.querySelector('sdg-header');
header.addEventListener('sdg-logout', async () => {
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  window.location.assign(response.ok ? '/' : '/error');
});
```

## What visitors see when a check fails

No header, never an unverified one. Whatever fails, visitors see the empty band the pre-load rule reserves and no Log
In or user menu, exactly as when the header host is down. Make sure your site stays usable without the header. The
reason is in the browser console:

| What failed                                                                                                | Console                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The loader's bytes don't match your tag's `integrity` (or `crossorigin` is missing)                        | The browser's own Subresource Integrity error for `loader.js`; the loader never runs.                                                                                               |
| The loader can't reach the manifest (host down, missing from `connect-src`)                                | `shared-ui: cannot fetch the header manifest` or `shared-ui: header manifest request failed`, plus any CSP report.                                                                  |
| The manifest's signature is not from a key this loader trusts                                              | `shared-ui: header manifest refused` with reason `bad-signature` or `unknown-key`.                                                                                                  |
| The manifest has expired                                                                                   | `shared-ui: header manifest refused` with reason `expired`.                                                                                                                         |
| The release is below the minimum version (the manifest's, or the one this browser remembers for your site) | `shared-ui: header manifest refused` with reason `below-floor`.                                                                                                                     |
| The manifest is malformed, for another environment or names a bundle outside the header's folder           | `shared-ui: header manifest refused` with reason `malformed`, `wrong-keyset` or `bad-bundle-path`.                                                                                  |
| The page is not a secure context (plain HTTP), so Web Crypto is missing                                    | `shared-ui: header manifest refused` with reason `crypto-unavailable`.                                                                                                              |
| The bundle's bytes don't match the manifest's hash                                                         | The browser's Subresource Integrity error for the bundle; the loader refetches the manifest and tries once more, then logs `shared-ui: header bundle failed to load after a retry`. |

If the browser cannot store the remembered minimum version (private browsing with storage blocked, cleared storage),
the header still loads after the other checks pass, and the loader logs that it used the manifest's minimum alone.

## Trust

The header runs with your page's privileges, like any third-party script: it can read and change your page. The loader
narrows whom you trust: only a release signed by this team's CI pipeline runs as the header on your site, even if the
portal's edge or the server that hosts the header is compromised. The browser checks the loader against your tag's
`integrity`; the loader accepts only a manifest signed with one of its environment's keys (a primary and a backup),
unexpired and not below the minimum version; and the browser checks the bundle against the manifest's hash.

What it covers is "released by this team's CI", not one exact build: a new release reaches your visitors without a
change on your site. It does not cover:

- **A compromised signing key.** The loader trusts its keys for the life of the major, so recovering from a compromised
  key, primary or backup, needs a new loader, and every site changes its tag.
- **Replay of a withdrawn release, until its manifest expires.** When a release is withdrawn (for example after a
  security fix), its old manifest stays valid until it expires, up to about 90 days. Each visitor's browser remembers
  the highest minimum version it has seen on your site and refuses anything below it, but a visitor with no remembered
  minimum on your site can still be served the withdrawn release by a compromised host: first visits, private browsing,
  cleared or blocked storage, and visitors arriving from other sites.
- **Sites whose pages this edge serves.** The portal's own apps are served by the same edge that serves the loader, so
  a compromised edge could change their pages, tag included. They get no protection from a compromised edge.
- **A compromised CI pipeline.** It holds the signing keys: it is what the guarantee trusts, not a threat it addresses.

Only add the header to sites that accept that trust in this team's releases.

## React apps in this repo

React apps in this monorepo use the typed wrapper from `@repo/shared-ui/header/react`. It renders the same
`<sdg-header>` element and, unless the page has already defined it, loads the header through the same loader as every
other site: it reads the loader's `{ src, integrity }` from the edge's same-origin `/shared-ui/header/v1/loader.json`
(which resolves on PR, TEST and PROD portal hosts) and injects the loader tag with that `integrity` and `crossorigin`.
It holds no header code itself.
Import the pre-load rule from the package instead of copying it:

```tsx
import '@repo/shared-ui/header/preload.css';
import { SdgHeader } from '@repo/shared-ui/header/react';

<SdgHeader siteTitle="My Service" userName={user?.name} loginHref="/login" onLogout={signOut}>
  <Link slot="nav" to="/">
    Home
  </Link>
</SdgHeader>;
```

TanStack Router's `Link` sets `aria-current="page"` on itself while its route is active, so the header shows it as
selected with no extra props.

| Prop                                 | Maps to                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `siteTitle`, `userName`, `loginHref` | The attributes above; `undefined` leaves the attribute off.                  |
| `onLogin`                            | `sdg-login`; receives the event, so it can call `preventDefault()`.          |
| `onLogout`                           | `sdg-logout`.                                                                |
| `fluid`                              | The `fluid` attribute: set when `true`, left off when `false` (the default). |
| `configUrl`                          | Overrides where the loader's `{ src, integrity }` is read from.              |

Using `<sdg-header>` directly in React JSX is typed too, through the package's JSX types for the element. Event types
are on `HTMLElementEventMap`, so `addEventListener('sdg-logout', …)` is typed.

## Versions

Only the major is in the URL (`v1`). Within a major the loader's URL and bytes never change, so its `integrity` stays
valid. A breaking change (to the attributes, slot or events, the header's reserved height, or what the pre-load rule
targets) ships as a new major with a new loader URL, and the previous major keeps being served while it is supported.
Everything else, rollbacks included, reaches your visitors on their next page load through a newly signed manifest.
