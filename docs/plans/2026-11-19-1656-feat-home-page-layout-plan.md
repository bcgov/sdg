---
title: Home Page Layout - Plan
type: feat
date: 2026-11-19
topic: home-page-layout
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Home Page Layout - Plan

## Goal Capsule

- **Objective:** A resident landing on the portal's home page (`/`) sees what the portal is for and can get to services right away, by searching or by browsing the full list.
- **Means:** The `/` route is rebuilt from bcgov design-system parts (`TextField`, `Button`, `Link` as a button, `Section`) on a full-bleed light-blue hero; `/services` starts accepting `q` (KTD1–KTD8).
- **Product authority:** This Product Contract.
- **Execution profile:** Two units in `apps/portal-web`. U2 needs U1.
- **Stop conditions:** Stop and ask if the hero can't reach the full window width without horizontal scrolling or without changing other routes' layout, or if the `h1` can't take H3 type without overriding the design system globally.
- **Open blockers:** None.
- **Finishing:** `ce-work` implements and verifies. Shipping follows the repo's normal PR flow.

---

## Product Contract

### Summary

The home page gets a 200px light-blue hero that spans the full window width, a search bar that straddles the hero's bottom edge and sends searches to `/services?q=…`, and a "Find a service" section with a 3 × 2 grid of light-gray placeholder boxes above an outline "View all services" link. The placeholder "Welcome to SDG" heading goes away.

### Problem Frame

`apps/portal-web/src/routes/index.tsx` renders a placeholder `h1` ("Welcome to SDG") and the flag-gated hello-world demo. It doesn't tell residents what the portal does or give them a way into services. The portal nav already links to `/services`, so the home page is the obvious front door for finding a service.

### Key Decisions

- **"View all services" uses the outline style.** Governs R9. (session-settled: user-directed — chosen over the primary style)
- **The hero sits flush under the header, and its blue spans the full window width.** The text and search stay inside the 1100px content column. Governs R1, R2. (session-settled: user-approved — proposed in the scoping summary and confirmed)
- **An empty or whitespace-only search goes to plain `/services`.** Governs R7. (session-settled: user-approved — proposed in the scoping summary and confirmed)
- **The hello-world flag demo stays, below the new section.** It is off by default and keeps the feature-flag tests meaningful. Governs R11. (session-settled: user-approved — proposed in the scoping summary and confirmed)
- **"View all services >" is a link styled as a button, with a trailing chevron icon.** Governs R9. (session-settled: user-approved — proposed in the scoping summary and confirmed)
- **"Find a service" shows a 3 × 2 grid of very light gray placeholder boxes above the button.** They hold the space for popular-service cards. Governs R13. (session-settled: user-directed — chosen over an empty section with only the button)

### Requirements

**Hero**

- R1. A hero band 200px tall with the bcgov light-blue background (`--surface-color-background-light-blue`) sits directly below the header, with no white gap above it. When the auth-error notice is shown, the hero sits below the notice instead.
- R2. The hero background spans the full viewport width, beyond the 1100px content container, and doesn't cause horizontal scrolling at any width.
- R3. The hero shows, centered horizontally and vertically, the page's only `h1`, "Access services online", styled as bcgov H3 (`--typography-bold-h3`).
- R4. Below the heading, the paragraph "Find services, track application statuses and manage your profile" is BC Sans Regular 18px with a 30px line height.

**Search**

- R5. A search form has a text field with a magnifying-glass icon on its left, the placeholder "Search for services", and a primary "Search" button. The field has an accessible name even though it has no visible label.
- R6. The search control is vertically centered on the hero's bottom edge, half over the light blue and half below it.
- R7. Submitting (Search button or Enter) navigates client-side to `/services?q=<trimmed query>`. An empty or whitespace-only query navigates to `/services` with no `q`.
- R8. `/services` accepts an optional string `q` search parameter without error. It doesn't filter or show results yet.

**Find a service**

- R9. Below the search, a section titled "Find a service" with the description "Choose from popular options or browse the full list." contains a centered, outline (bcgov `secondary`) "View all services" link with a trailing chevron that navigates client-side to `/services`.

**Page**

- R10. The "Welcome to SDG" heading no longer appears.
- R11. The flag-gated hello-world message, when its flag is on, renders below the "Find a service" section. The auth-error notice keeps working on `/`.
- R12. At phone width the hero text wraps without overflowing, and the search field and button stay usable.
- R13. Between the section's description and the "View all services" link, six decorative placeholder boxes sit in a 3-column, 2-row grid with the bcgov light-gray background (`--surface-color-background-light-gray`). At phone width they stack in one column. Assistive technology ignores them.

### Acceptance Examples

- AE1. Covers R7. Typing " dog licence " and pressing Enter lands on `/services?q=dog+licence` (TanStack encodes the value) without a full page load.
- AE2. Covers R7. Clicking Search with an empty field lands on `/services` with no `q`.
- AE3. Covers R2, R6. At 1280px wide the hero's left and right edges match the viewport's, the document doesn't scroll horizontally, and the search control's vertical center is within a pixel of the hero's bottom edge.

### Scope Boundaries

- Real popular-service cards (content, links, data) in "Find a service": out of scope. Only empty placeholder boxes ship.
- Filtering or results on `/services`, and populating the Services page's search box from `q`: out of scope.
- Search suggestions or autocomplete: out of scope.
- Layout changes on any route other than `/`: out of scope.

### Sources / Research

- `apps/portal-web/src/components/root-layout/root-layout.module.css`: the `.container` (1100px, `--layout-padding-large` block padding) every route renders inside.
- `packages/design-system/src/components/section/section.tsx`: titled section with an `h2` (bold H5), description paragraph and yellow bar, already used on Settings.
- `@bcgov/design-system-react-components` 0.9.1: `TextField` has `iconLeft`; `Button` has `variant: primary | secondary | tertiary | link`; `Link` has `isButton` and `buttonVariant`.
- `apps/portal-web/src/components/link/index.tsx`: `createLink(DesignSystemLink)` gives router navigation, type-safe `to` and preloading.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The hero escapes the container with container-query units, not `100vw`.** `main` becomes an inline-size container (`container-type: inline-size`) and the hero uses `margin-inline: calc(50% - 50cqw)`. `100vw` includes the vertical scrollbar on desktop browsers that show one, which causes horizontal scroll. Restructuring the root layout so routes own their container would touch every route. The hero also cancels the container's top padding (`margin-block-start: calc(-1 * var(--layout-padding-large))`) to sit flush under the header. The root layout's `.container > :first-child { margin-block-start: 0 }` (specificity 0,2,0) would override a single `.hero` class, and CSS Modules hash `.container` per file, so the home page can't name it. Instead the home page wraps its content in its own `.page` element and puts the negative margin on `.page > .hero:first-child` (0,3,0). Inside the full-bleed `.hero`, an inner `.heroInner` column (`max-width: 1100px`, centered, same inline padding as the container, `height: 200px`, `position: relative`) holds the heading, lede and search, so they stay in the content column. Governs R1, R2.
- KTD2. **The search form is the inner hero column's last child, absolutely positioned on its bottom edge.** `.heroInner` is the positioned box. The form sits at `bottom: 0` with `translateY(50%)`, and the hero reserves a bottom margin of half the control's height so the next section clears it. This keeps the heading and paragraph centered in the full 200px, independent of the control's height. Governs R3, R6.
- KTD3. **Search is a native `<form role="search">` with an `onSubmit` handler.** It calls `navigate({ to: '/services', search: q ? { q } : {} })`, so Enter and the button share one path. The field is a controlled bcgov `TextField` (`aria-label="Search for services"`, `iconLeft` = FontAwesome `faMagnifyingGlass`). The button is a bcgov `Button` with `type="submit"` and `variant="primary"`. Governs R5, R7.
- KTD4. **`/services` declares `validateSearch` returning `{ q?: string }`.** The router's default search parser turns `?q=2024` into a number and `?q=true` into a boolean before `validateSearch` runs, so a number or boolean `q` is converted back with `String(q)`. A string `q` is trimmed. Anything else, or an empty result, becomes `undefined`. This makes `navigate({ to: '/services', search: { q } })` type-check and leaves the services page unchanged otherwise. Governs R8.
- KTD5. **"Find a service" reuses `@repo/design-system`'s `Section`.** Its title and description are the title and subtitle the request asks for, and it matches Settings. The button row is a child `div` with `justify-content: center`. The link is the app's router `Link` with `isButton buttonVariant="secondary"` and a trailing `faChevronRight` icon (`aria-hidden`). Governs R9.
- KTD6. **H3 styling on the `h1` comes from a CSS-module class on the bcgov `Heading`.** A class like `.title { font: var(--typography-bold-h3); }` is applied with `level={1}`, using the app's existing unprefixed token names. If bcgov's heading selector outranks a single class, raise specificity locally (for example `.hero .title`), never with a global override. Governs R3.
- KTD8. **The placeholder grid is a CSS grid of six empty `div`s inside the `Section`, before the button row.** It uses `grid-template-columns: repeat(3, 1fr)` and drops to one column below the bcgov small breakpoint. Each box has a fixed height (about 160px) and the light-gray background. The grid wrapper is `aria-hidden="true"` so screen readers skip it. Governs R13.
- KTD7. **The home page moves into `src/components/home-page/`.** The route file keeps `validateSearch` and the auth-error dismissal and renders the component, the same split as `settings-page`. `HomeSearch` is its own file so its test can drive it in isolation. Governs R5–R11.

### High-Level Technical Design

Directional structure only:

```
<main class="main" container-type=inline-size>
  <div class="container">
    <div class="page">
      [AuthErrorNotice]                      (only with ?authError)
      <div class="hero">                     full-bleed light blue; flush to header when first child
        <div class="heroInner">              1100px column, 200px, position: relative
          <Heading level=1 class="title">    Access services online
          <p class="lede">                   Find services, track ...
          <form role="search" class="search">  absolute, bottom: 0, translateY(50%)
            <TextField aria-label iconLeft=magnifier placeholder>
            <Button type=submit variant=primary>Search</Button>
      <Section title="Find a service" description="Choose from ...">
        <div class="grid" aria-hidden>       3 × 2 light-gray boxes (1 column on phones)
        <div class="actions"> <Link to="/services" isButton buttonVariant="secondary">View all services ›</Link>
      <HelloWorld/>                          (flag-gated)
```

When the auth-error notice is shown, it renders above the hero. `.page > .hero:first-child` then no longer matches, so the hero keeps normal flow and doesn't pull up under the notice.

### Risks

- **Container-query units in older browsers.** `cqw` is supported in all evergreen browsers since 2023. If the portal's browser floor is older, fall back to `width: 100vw` plus `overflow-x: clip` on `main`. The clip hides the scrollbar-width overhang, which is what keeps R2 and AE3 true on that path.
- **`container-type` on `main` creates a containment context.** It sets size containment on the inline axis only, so height still comes from content. Check that the sticky footer layout (`layout.spec.ts`) still passes.
- **bcgov `TextField` icon slot sizing.** `iconLeft` expects a React element. If FontAwesome's SVG renders at the wrong size, size it with the icon's own props, not a `style` attribute (CSP: no inline style attributes in markup, see `AGENTS.md`).

---

## Implementation Units

### U1. Services route accepts `q`

- **Goal:** `/services` takes an optional `q` search param so the home search can navigate to it type-safely.
- **Requirements:** R8.
- **Dependencies:** None.
- **Files:** `apps/portal-web/src/routes/services.tsx`, `apps/portal-web/src/app.test.tsx`.
- **Approach:** Add `validateSearch` per KTD4. Leave the page body as is. `routeTree.gen.ts` regenerates on dev/build.
- **Test scenarios:**
  - Rendering `/services?q=dog` shows the Services heading and `router.state.location.search` has `q: 'dog'`.
  - Rendering `/services?q=` and `/services` both show the heading with `q` undefined.
  - Rendering `/services?q=2024` keeps `q: '2024'` as a string.
- **Verification:** `pnpm --filter portal-web test` and `pnpm --filter portal-web typecheck` pass.

### U2. Home page hero, search and "Find a service"

- **Goal:** `/` renders the new layout and the search navigates to `/services`.
- **Requirements:** R1–R7, R9–R13.
- **Dependencies:** U1.
- **Files:**
  - `apps/portal-web/src/routes/index.tsx`
  - `apps/portal-web/src/components/home-page/index.tsx`
  - `apps/portal-web/src/components/home-page/home-search.tsx`
  - `apps/portal-web/src/components/home-page/home-page.module.css`
  - `apps/portal-web/src/components/home-page/home-page.test.tsx`
  - `apps/portal-web/src/components/root-layout/root-layout.module.css` (`container-type` on `.main`)
  - Tests that assert "Welcome to SDG": `apps/portal-web/src/app.test.tsx`, `apps/portal-web/src/routes/_authenticated/account-settings.test.tsx`, `apps/portal-web/e2e/layout.spec.ts`, `apps/portal-web/e2e/feature-flags.spec.ts`, `apps/portal-web/e2e/shared-header.spec.ts`, `apps/portal-web/e2e/setup/client.setup.ts`
- **Approach:** Build the structure in the design sketch, following KTD1–KTD3 and KTD5–KTD8. Replace every "Welcome to SDG" assertion with "Access services online". The e2e test "spaces content from the container edges by the container padding alone" loads `/`, where the flush hero now cancels the top padding on purpose. Point it at `/services`, whose layout doesn't change, so it keeps checking the container padding. In `app.test.tsx` the hello-world ordering test asserts the message follows the "Find a service" section rather than the `h1`. Use only CSS-module classes, with no `style` attributes (edge CSP).
- **Test scenarios (Vitest, `home-page.test.tsx` and `app.test.tsx`):**
  - `/` has exactly one `h1`, "Access services online", and the lede paragraph text.
  - The search landmark (`getByRole('search')`) contains a textbox named "Search for services" with that placeholder and a "Search" button.
  - Typing " dog licence " and pressing Enter navigates to `/services` with `q: 'dog licence'` (AE1). Clicking Search does the same.
  - Clicking Search with an empty or whitespace-only field navigates to `/services` with no `q` (AE2).
  - The "Find a service" region (`getByRole('region', { name: 'Find a service' })`) has the description and a link named "View all services" with `href="/services"`. Clicking it navigates to `/services`.
  - The "Find a service" region holds an `aria-hidden` grid of exactly six placeholder boxes, placed before the "View all services" link in document order (R13).
  - With `?authError=…` the auth-error notice still renders and dismisses.
  - With the hello-world flag on, the message follows the "Find a service" region in document order.
- **Test scenarios (Playwright, `e2e/layout.spec.ts`):**
  - At 1280px and 375px wide, the hero's `left` is 0 and its `right` equals `document.documentElement.clientWidth`, and `scrollWidth` equals `clientWidth` (AE3, R2, R12).
  - The hero's top equals the header's bottom, and its height is 200px (R1).
  - The search control's vertical midpoint is within 1px of the hero's bottom edge (R6).
  - At 1280px the six placeholder boxes form 3 columns × 2 rows (two distinct `top` values, three distinct `left` values). At 375px they form one column (R13).
  - The existing sticky-footer layout tests still pass.
- **Verification:** `pnpm --filter portal-web test`, `pnpm --filter portal-web typecheck`, `pnpm lint` and `pnpm --filter portal-web test:e2e` pass, and a visual check of `/` at desktop and phone width looks right in the local stack.

---

## Verification Contract

- `pnpm --filter portal-web typecheck`
- `pnpm --filter portal-web test` (includes `src/csp-hashes.test.ts`, which must stay green with no new style hashes)
- `pnpm --filter portal-web test:e2e`
- `pnpm lint` and `pnpm format:check`
- Manual: open `https://sdg.localhost/` at desktop and phone widths, then search, and check the result in the address bar.

---

## Definition of Done

- R1–R13 hold, and AE1–AE3 are covered by passing tests.
- No route other than `/` changes visually. Every existing layout and header test passes, updated only for the new heading text, plus the container-padding test moving from `/` to `/services`.
- No `style` attributes or new inline `<style>`, and the CSP hash test is unchanged.
- No file over 300 lines, and no leftover experimental CSS or code from approaches that were dropped.
