# @repo/design-system

The B.C. Design System (BCDS, [`@bcgov/design-system-react-components`](https://github.com/bcgov/design-system)) for the portal's React apps, plus our extensions to it. Apps import subpaths only. There is no root export:

| Import                                        | Gives                                                        |
| --------------------------------------------- | ------------------------------------------------------------ |
| `@repo/design-system/components/<kebab-name>` | One component and its `*Props` type                          |
| `@repo/design-system/icons`                   | Font Awesome (`FontAwesomeIcon`, solid icons, `regular.*`)   |
| `@repo/design-system/styles.css`              | CSS for our own components (CSS Modules, extracted at build) |
| `@repo/design-system/fonts.css`               | BC Sans                                                      |

Apps read the built `dist/`, so run `pnpm turbo run build --filter=portal-web` (or the package's `build`) after a change before checking it in the app.

## Kinds of component

| Kind         | What it is                                                | Examples                     | Registered in `components.test.ts` |
| ------------ | --------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| Re-exported  | The BCDS component as is                                  | `checkbox`, `heading`        | `expected` table                   |
| Extended     | A BCDS component under its own name, with added behaviour | `button` (`warning` variant) | `expected` table + `extended` set  |
| New (custom) | Built here; not in BCDS or react-aria                     | `avatar`, `card`, `nav-link` | `custom` table                     |

Prefer them in that order: use a BCDS component if one fits, extend one if it nearly fits, and build a new one only when neither works. Never edit or patch the BCDS package itself.

Each component lives in `src/components/<kebab-name>/`. The folder name is the subpath: [vite.config.ts](vite.config.ts) makes every `src/components/<name>/index.ts` a build entry, so the entry file must be `index.ts`, not `index.tsx`.

## Re-exporting a BCDS component

```ts
// src/components/checkbox/index.ts
import { Checkbox, CheckboxGroup } from '@bcgov/design-system-react-components';
import type { ComponentProps } from 'react';

export { Checkbox, CheckboxGroup };

export type CheckboxProps = ComponentProps<typeof Checkbox>;
export type CheckboxGroupProps = ComponentProps<typeof CheckboxGroup>;
```

Add the subpath and its export names to the `expected` table in [components.test.ts](src/components/components.test.ts). That test fails if any BCDS component is exported twice or not at all.

## Extending a BCDS component

Example: [button](src/components/button/).

- Put the wrapper in `<name>.tsx`. Import the original under an `Upstream*` alias and derive its props:

  ```tsx
  import { Button as UpstreamButton } from '@bcgov/design-system-react-components';

  type UpstreamButtonProps = ComponentProps<typeof UpstreamButton>;

  export type ButtonProps = Omit<UpstreamButtonProps, 'variant'> & {
    variant?: UpstreamButtonProps['variant'] | 'warning';
  };
  ```

- Pass anything you don't change straight through (`<UpstreamButton {...props} />`), so existing behaviour stays upstream's.
- Keep the upstream name (`Button`) so apps don't change imports, and keep `index.ts` as a re-export of `./<name>`.
- Add the subpath to the `extended` set in [components.test.ts](src/components/components.test.ts). It stays in the `expected` table, but is no longer checked to be the upstream function itself.
- **className quirk:** BCDS components spread props _after_ their own `className`, so passing `className` replaces BCDS's classes instead of adding to them. Two ways round it:
  - Use the upstream's unstyled option plus your own class, where it has one (`Link` has `isUnstyled`; see [nav-link](src/components/nav-link/nav-link.tsx)). The styling is then all ours.
  - Restate BCDS's classes alongside yours, when you need its styling (button keeps BCDS sizing for `warning`; `Button` has no unstyled option). This depends on BCDS's internal class names (`bcds-react-aria-Button`, size, `icon`), which aren't a public API. Cover them in the component's test so a BCDS upgrade that renames them fails loudly.
- Add the new value or prop to the component's page under `/dev` (see [Trying it out](#trying-it-out)).

## Building a new component

Examples: [card](src/components/card/), [avatar](src/components/avatar/), [nav-link](src/components/nav-link/).

Files, in `src/components/<kebab-name>/`:

```
index.ts            export { Card } from './card'; export type { CardProps } from './card';
card.tsx            the component
card.module.css     its styles
card.test.tsx       Vitest + Testing Library
```

Register it in the `custom` table in [components.test.ts](src/components/components.test.ts), and add its `*Props` to the "declares the custom component props" check in [package-exports.test.ts](src/package-exports.test.ts).

### Shape the API so BCDS could adopt it

- **Named slot props, not compound components.** BCDS's `Callout` takes `title`, `description`, `buttons` and `children`; there's no `Card.Header`. Card follows it.
- **Reuse BCDS prop names:**
  - `titleElement` (`"h1"`–`"h6"`) for a heading level, as on `Header` and `AccordionGroup`;
  - `size` for `"small" | "medium" | "large"`;
  - `variant` for a camelCase string union.
- **App-supplied elements come in as `*Element` props.** An example is card's `linkElement`, which follows `Header.logoLinkElement`. The component never imports a router or app code; the app passes its router-aware link (`<Link to="…" />`).
- **Use BCDS and react-aria pieces inside** (`Heading`, `Link`) rather than raw elements, so they pick up BCDS styling and accessibility.
- **Booleans:** this package uses plain names (avatar `decorative`, card `column` / `centered`). BCDS mostly uses `isXxx`, so rename them if a component is proposed upstream.

### Code conventions

These are the conventions avatar, card, nav-link and button share:

- An explicit `JSX.Element` return type, with defaults set in destructuring.
- Props as an `interface` (avatar), unless a union or intersection needs a `type`. Card needs one so TypeScript rejects `column` with `centered`; button needs one for `Omit<…> & {…}`.
- **Root props:**
  - A component people place in lists or grids spreads other HTML attributes onto its root, as BCDS components do. Card uses `Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'>` plus `...props`, so callers can set `id`, `aria-*` and `data-*`; nav-link spreads onto the upstream link.
  - A fixed visual like avatar takes only its own props plus `className`.
- Classes merge as `[styles['x'], modifier, className].filter(Boolean).join(' ')`, with bracket access (`styles['x']`).
- JSDoc on props whose meaning or default isn't obvious from the name.

### Styling

- CSS Modules (`<name>.module.css`) using BC design tokens (`--surface-color-*`, `--layout-*`, `--typography-*`, `--icons-*`). The full list is in `@bcgov/design-tokens` (`css/variables.css`); the tokens reach the page through the BCDS components. Use raw values only where no token exists (avatar's 32/40/56px sizes).
- **Variants are modifier classes** (`styles[size]` in avatar, `styles['column']` / `styles['centered']` in card), like BCDS's `bcds-react-aria-Button medium primary`.
- **Interaction states use react-aria's data attributes** (`[data-hovered]`, `[data-pressed]`, `[data-focus-visible]`, `[data-disabled]`).
- No Tailwind, and no global class names.

### Accessibility

- Use a semantic root (`<article>` for a self-contained item), named by its visible title (`aria-labelledby`).
- Hide decorative icons (`aria-hidden="true"`). Give images real `alt` text, or `alt=""` when decorative.
- Clickable containers use a single link plus a CSS overlay (card's "stretched link"), never a `<button>` or `<a>` wrapped round other interactive content. Anything interactive inside sits above the overlay.
- oxlint's `jsx-a11y` rules run in `pnpm lint`. There's no axe, so check keyboard focus by hand on the `/dev` page.

### Tests

Co-locate `<name>.test.tsx`, and query by role (`getByRole('article', { name })`, `getByRole('link', { name })`), as in [avatar.test.tsx](src/components/avatar/avatar.test.tsx) and [card.test.tsx](src/components/card/card.test.tsx). Clean up between tests with `afterEach(cleanup)`. Use `@ts-expect-error` to prove a prop combination doesn't type-check.

## Trying it out

portal-web has unlinked local helper pages under [`/dev`](../../apps/portal-web/src/routes/dev/): `/dev` lists them, and each component has its own page (`/dev/button`, `/dev/card`). Add a page and a link on `/dev` for each new component, showing every variant and state.

In the Docker stack, the `portal-web` container's file watcher can miss changes. If the page shows old code, run `docker compose restart portal-web`.

## Checks

```sh
pnpm --filter @repo/design-system test
pnpm --filter @repo/design-system typecheck
pnpm lint
pnpm format:check
```

## Checklist

- [ ] No BCDS component fits as is (re-export) or nearly (extend).
- [ ] Folder `src/components/<kebab-name>/` with `index.ts`, `<name>.tsx`, `<name>.module.css`, `<name>.test.tsx`.
- [ ] Registered in `components.test.ts` (`expected` + `extended`, or `custom`), and new `*Props` in `package-exports.test.ts`.
- [ ] Props follow BCDS names and slots, and nothing is imported from an app or router.
- [ ] Tokens only (or a noted exception); modifier classes for variants; react-aria data attributes for states.
- [ ] Semantic, labelled markup; decorative icons hidden; keyboard focus visible.
- [ ] Role-based tests.
- [ ] A `/dev` page in portal-web.
- [ ] All the checks above pass.
