# @repo/shared-ui

Shared UI served to any website from the edge. Today that is one component: the SDG header, a `<sdg-header>` custom
element built with Preact.

Every site loads the header the same way, with one script tag, so every site runs the same release. Each major
version has one URL that always serves the latest release in that major, and visitors get a new release (or a
rolled-back one) on their next page load. Nobody redeploys to pick it up.

| Environment | Script URL                                                     |
| ----------- | -------------------------------------------------------------- |
| PROD        | `https://<portal-host>/shared-ui/header/v1/sdg-header.js`      |
| TEST        | `https://<test-portal-host>/shared-ui/header/v1/sdg-header.js` |
| PR preview  | `https://<pr-portal-host>/shared-ui/header/v1/sdg-header.js`   |

`<portal-host>` is the portal's host in that environment. Point your TEST site at the TEST header so you see releases
there before PROD.

## Adding the header to a site

Any site, React or not, needs four things: a CSP allowance, a pre-load CSS rule, the script tag and the markup.

### 1. Allow the header's host in your CSP

Add the portal host to `script-src`:

```
Content-Security-Policy: script-src 'self' https://<portal-host>
```

That is the only CSP change. The header injects no `<style>` elements (its styles are a constructed stylesheet, which
`style-src` does not govern), loads no fonts and draws its logo as inline SVG, so `style-src`, `font-src` and `img-src`
need nothing.

### 2. Add the pre-load CSS rule

Until the script has defined the element, this rule reserves the header's full height and hides the raw nav links, so
nothing on the page moves when the header appears. The header is 104px tall, or 142px on screens narrower than 576px
when you set `site-title` (the title moves to its own row there). Copy it into your own stylesheet:

```css
sdg-header:not(:defined) {
  display: block;
  height: 104px;
}

@media (max-width: 575.98px) {
  sdg-header[site-title]:not([site-title='']):not(:defined) {
    height: 142px;
  }
}

sdg-header:not(:defined) > * {
  display: none;
}
```

This rule stays valid for the whole of v1: changing what it targets or the header's height is a new major.

### 3. Add the script tag

```html
<script src="https://<portal-host>/shared-ui/header/v1/sdg-header.js" async></script>
```

It is a classic script: it needs no `type="module"` and no CORS. If your site sends
`Cross-Origin-Embedder-Policy: require-corp`, add `crossorigin` to the tag; the header's files answer with
`Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`, and never accept credentials.

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
  served, so it points at the same environment (PR, test or production) as the script you load.
- **Unknown:** neither set, for example while your site is still checking the session. The grey row keeps its
  height and shows no control, so nothing moves when you set one of them.

Change the attributes at any time; the header re-renders.

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

## What visitors see if the script fails to load

No header. If the script cannot be loaded (the header host is down, blocked by a network filter or missing from your
CSP), visitors see the empty band the pre-load rule reserves and no Log In or user menu. This is the accepted
cost of one delivery path for every site; make sure your site stays usable without the header.

## Trust

The header script runs with your page's privileges, like any third-party script: it can read and change your page.
It cannot be pinned with Subresource Integrity (`integrity`), because the URL deliberately serves each new release in
the major, so its hash changes with every release. Only add it to sites that accept that trust in this team's
releases.

## React apps in this repo

React apps in this monorepo use the typed wrapper from `@repo/shared-ui/header/react`. It renders the same
`<sdg-header>` element, loads the script from the same origin (`/shared-ui/header/v1/sdg-header.js`, which resolves on
PR, TEST and PROD portal hosts) unless the page has already defined the element, and holds no header code itself.
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
| `src`                                | Overrides the script URL.                                                    |

Using `<sdg-header>` directly in React JSX is typed too, through the package's JSX types for the element. Event types
are on `HTMLElementEventMap`, so `addEventListener('sdg-logout', …)` is typed.

## Versions

Only the major is in the URL (`v1`). A breaking change (to the attributes, slot or events, the header's reserved
height, or what the pre-load rule targets) ships as a new major at a new URL, and the previous major keeps being
served while it is supported. Everything else reaches your visitors on their next page load.
