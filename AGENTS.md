# AGENTS.md

Repository facts for automated coding assistants. Teams may edit or remove this file.

## Layout

- pnpm + Turborepo monorepo: `apps/` (React + Vite, NestJS), `packages/` (Node/React libraries, Vite library mode), `tooling/` (repo-only `@repo/*` config packages: `typescript-config`, `vite-config`, `vitest-config`, `playwright-config`).
- Each app owns its `.env.example` (no root one); `.env` / `.env.*` are gitignored everywhere.
- Tool versions live in the pnpm `catalog:` in `pnpm-workspace.yaml`; reference them as `"catalog:"` and workspace packages as `"workspace:*"`. pnpm settings belong in `pnpm-workspace.yaml`, not `.npmrc`.
- Workflows: `.github/workflows/` (PR deploys via `reusable-deploy.yml`, tests via `reusable-tests.yml`).
- `compose.yaml` runs the local stack (dev commands behind Caddy at `https://sdg.localhost`) with every `node_modules` as a named volume: a new workspace package needs its `node_modules` volume added to `x-workspace` and `volumes:` there.

## Build, test, run

- `pnpm build | dev | typecheck | test | test:e2e` run through Turborepo; `pnpm lint` (oxlint, type-aware), `pnpm format` / `format:check` (oxfmt) and `pnpm test:all` (Vitest projects) run at the root.
- TypeScript 7 has no compiler API: don't add tools that need it (e.g. vite-plugin-dts). Libraries emit `.d.ts` with `vite build && tsc -p tsconfig.build.json`. React libraries use extensionless relative imports; Node libraries (consumed by NestJS apps on `nodenext`) use `.js` relative imports so their emitted `.d.ts` resolve.
- NestJS apps build with the Nest CLI on TypeScript 6 (`"typescript": "catalog:ts6"`), which still has the compiler API; constructor injection uses explicit `@Inject(...)`.
- portal-api validates requests with zod through the global `StandardSchemaValidationPipe`: declare schemas inline (`@Body/@Query/@Param({ schema })`) and pass response schemas to `@ApiOkResponse({ standardSchema })` for OpenAPI. No DTO classes or class-validator.
- Load tests: k6 scripts in `tests/load` (not a workspace package; k6 runs the `.ts` with explicit `.ts` imports; typecheck via `tsc -p tests/load` in root `typecheck`; `@types/k6` from the catalog). Run with `BASE_URL=… pnpm test:load`; never against PROD.
- Tooling packages ship `.ts` source run by Node type stripping: use explicit `.ts` relative imports and erasable syntax only.
- Workspace tsconfig layout: `tsconfig.json` is a solution file referencing `tsconfig.app.json` or `tsconfig.lib.json` (src), optionally `tsconfig.test.json` (tests needing `node`/`vite/client` types), and `tsconfig.node.json` (`*.config.ts`); `typecheck` runs `tsc -b`. Emitting packages add `tsconfig.build.json` extending a `@repo/typescript-config/*-build.json` preset.
- `defineReactAppConfig` appends override plugins after `react()`. A plugin that must run before it (e.g. TanStack Router's `tanstackRouter()`) goes in front: `mergeConfig({ plugins: [plugin()] }, defineReactAppConfig(...))`.
- The header is the `<sdg-header>` Lit web component in `packages/sdg-header` (the only header apps use; `@repo/design-system`'s `header` subpath re-exports the bcgov React `Header` and is not for app use). React apps use the typed `<SdgHeader>` from `@repo/sdg-header/react` (React 19 only; portal-web wires it in `components/site-header`). Function inputs are named `*Fn` (`signOutFn`, `navigateFn`) because React 19 treats `on*` props on custom elements as event listeners.
- `packages/sdg-header` is a browser library: `@repo/typescript-config/browser-library*.json` presets, `defineLibraryConfig({ platform: 'browser' })`, `.js` relative imports. It builds `dist/index.js` and `dist/react/index.js` (registry; lit and react external, react an optional peer) and `dist/cdn/sdg-header.js` (`vite build --mode cdn`, self-contained). Entries register the element by calling `defineSdgHeader()`, never with a bare side-effect import, which the build can drop. Nested Lit templates inside `<svg>` must use the `svg` tag, not `html`.
- `<sdg-header>` CSS uses `var(--bcgov-token, <token value>)`; `tokens.test.ts` fails when `@bcgov/design-tokens` changes a value. `logo.test.ts` fails when the upstream logo changes: run `pnpm --filter @repo/sdg-header generate:logo`.
- Production images (`apps/portal-web/Dockerfile`, `apps/portal-api/Dockerfile`, `packages/portal-database/Dockerfile`) build from the repo root (`podman build -f <dir>/Dockerfile .`); the edge builds from `apps/portal-web/caddy`. Server apps use `pnpm deploy --prod` (not `--legacy`, which re-resolves). Every image must start with all capabilities dropped: Caddy binaries must carry no file capability (`XCADDY_SETCAP=0`, `setcap -r`). Check with `scripts/images-smoke.sh`.
- Helm charts live in `charts/` (one per app/service, `common` library, `sdg` umbrella; see `charts/README.md`). After a chart change run `pnpm test:charts` (needs the helm-unittest plugin and kubeconform). Map values that carry platform defaults (e.g. `ingress.annotations`) stay `{}` in values.yaml and fall back in the template, since Helm merges maps instead of replacing them.
- Postgres keeps about `max(max_wal_size, wal_keep_size)` of WAL (Patroni's default reserve is 128MB), so keep both at a quarter of the data volume or less (`postgres.parameters` in `charts/sdg/values-<env>.yaml`).
- Deploys to OpenShift run from GitHub Actions (PR open, merge), not from a workstation

## Shared actions

- Uses bcgov shared actions and workflows (`bcgov/action-*`, `bcgov/actions/*`, `bcgov/actions-openshift/*`, `bcgov/quickstart-openshift-helpers`). Use them as provided; don't copy or fork them.
- Never pin `@main`. Pin bcgov shared actions to a published release SHA with a `# vX.Y.Z` comment.
- Vanity Route TLS (`bcgov/actions-openshift/route-tls`) is strictly managed via the standalone on-demand workflow (`.github/workflows/route-tls.yml` with `workflow_dispatch`). Never embed `route-tls` into `merge.yml`, `release.yml`, or continuous deployment pipelines.

## Settings

- Automated agents must not change repository or organization settings. Settings changes are made by a person on the team with the setup scripts in `scripts/`; agents may run them only without `--apply`, which previews.
- After a repository is created from the template, suggest running `scripts/setup.sh`.
