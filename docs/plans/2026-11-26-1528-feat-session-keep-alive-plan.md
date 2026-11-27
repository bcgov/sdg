---
title: Session Keep-Alive - Plan
type: feat
date: 2026-11-26
topic: session-keep-alive
execution: code
---

# Portal: handle expired sessions and keep active users signed in

## Context

The client's Keycloak lifetimes on gold are: access token 5 min, refresh token 30 min (the real idle limit), session max 10 h. bff-core refreshes the access token only when a forwarded `/api/v1/*` call finds it within 30 s of expiry (`packages/bff-core/src/refresh/token-refresh.service.ts`). After about 30 min with no forwarded call, the next call's refresh gets `invalid_grant`. The BFF destroys the session and answers 401, and portal-web's `fetchProfile` (`apps/portal-web/src/profile/api.ts`) turns any non-2xx into an error. Settings then shows "We couldn't load your details" instead of asking the user to sign in. `GET /api/auth/me` answers from the session row alone (a tested requirement: `auth.controller.test.ts` "answers from the session alone, without core-api or Keycloak"), so the header can still show the user as signed in.

Goals:

1. An expired session sends the user to sign in again, returning to the same page, never to an error state.
2. An active user stays signed in until Keycloak's 10 h maximum.
3. An idle user is warned before the session ends and can extend it with one click (WCAG 2.2.1).
4. An idle tab never keeps the session alive.

Deliver as two PRs. PR 1 fixes the bug; PR 2 adds the keep-alive and the warning.

## PR 1: one 401 path in portal-web

Mirror console-web's existing pattern; don't invent a new one:

- `apps/console-web/src/api/http.ts`: `ApiError` with a `kind`, plus `apiRequest()`
- `apps/console-web/src/api/use-refusal-redirects.ts`: QueryCache/MutationCache subscription
- `apps/console-web/src/components/app-shell/app-shell.tsx` `useSessionEndedRedirect`: the current user turning `null`

Changes:

- **New `apps/portal-web/src/api/http.ts`**: `ApiError` (`session-ended` for 401; `unavailable` for 502/503/504 or no answer; `unexpected` otherwise) and `apiRequest(path)`. Same-origin, always reads the body (the Chromium note), resolves parsed JSON. It's a trimmed copy of console-web's. A shared package is a later refactor, out of scope.
- **`profile/api.ts`**: `fetchProfile` uses `apiRequest` and keeps its `isProfile` check. `auth/api.ts`'s `fetchCurrentUser` keeps returning `null` on 401, because signed out is a normal answer there.
- **New `apps/portal-web/src/auth/use-session-ended-redirect.ts`**, mounted once in `components/root-layout/index.tsx`:
  - It subscribes to the query and mutation caches. On `ApiError` `session-ended` it calls `queryClient.setQueryData(currentUserQueryKey, null)`.
  - If the user was signed in and the current route needs a session (under `_authenticated`; check with `router.state.matches` for the `/_authenticated` route id), it does `window.location.assign(loginHref(location.href))`. This is the same full-page BFF login the `_authenticated` guard (`routes/_authenticated.tsx`) uses.
  - On public pages, clearing `me` is enough: `useHeaderAuth` already switches the header to Log In.
  - It guards against more than one redirect, since a page's other calls fail the same way.
- **`auth/use-current-user.ts`**: no change. `refetchOnWindowFocus` already re-checks `/me` when the tab is focused.

Tests (Vitest, `apps/portal-web`):

- `api/http.test.ts`: status-to-kind mapping, no-answer becomes `unavailable`, the body is read.
- `use-session-ended-redirect.test.tsx`:
  - a 401 profile query on `/settings` calls the injected `navigate` with `loginHref('/settings')` and sets `me` to `null`;
  - a 503 leaves the user in place and shows Settings' error state;
  - on a public route a 401 only clears `me`;
  - two 401s redirect once.
- Update `routes/_authenticated/settings.test.tsx`: an expired session redirects rather than showing the alert.

## PR 2: activity-based keep-alive and the expiry warning

### packages/auth

- `OidcTokens` (`src/types.ts`) gains:
  - `refreshExpiresAt: number | null`, from Keycloak's `refresh_expires_in` (`response['refresh_expires_in']`, a number; `0` or missing becomes `null`);
  - `obtainedAt: number`.
- Map both in `toTokens` and `toRefreshedTokens` (`src/oidc-client.ts`).
- `test-support/fake-idp.ts` sends `refresh_expires_in: 1800` in both token responses.
- Sessions saved before this ship lack both fields. Readers treat a missing `obtainedAt` as stale and a missing `refreshExpiresAt` as unknown.

### packages/bff-core

- `TokenRefreshService.keepAlive(req)` returns `SessionToken` plus `idleExpiresAt`. It refreshes through the existing `refreshOnce` → `saveTokens` / `refreshFailed` path:
  - when the access token expires soon (existing rule), or
  - when the tokens were obtained more than `KEEP_ALIVE_MIN_AGE_MS` (60 s) ago.

  This renews the refresh token on every ping without asking Keycloak more than once a minute per session. It reuses the existing in-process dedupe and the re-read when another pod got there first. Keep `accessToken()` as it is.

- **New `POST /api/auth/keep-alive`** in `auth/auth.controller.ts` (POST because it changes the session, so `OriginGuard` applies). Answers:
  - 200 `{ idleExpiresAt: number | null }`, with a zod response schema in `@ApiOkResponse({ standardSchema })`;
  - 401 with the cookie cleared when the session is missing or ended (same `clearCookie` as `bff-forward.controller.ts:101`);
  - 503 when Keycloak is unavailable, keeping the session.
- `GET /api/auth/me` stays session-only. Its test and behaviour during an IdP outage are unchanged.
- Log through `describeError` as today.
- console-api gets the endpoint too but nothing calls it there yet.

### portal-web

- **New `src/auth/keep-alive.ts`**: `postKeepAlive()` through `apiRequest` (POST). It returns `idleExpiresAt`, and its 401 flows into PR 1's redirect.
- **New `src/auth/use-session-keep-alive.ts`**, active only while `me` is a user:
  - Records the last activity from passive, throttled `pointerdown`, `keydown`, `scroll` and `touchstart` listeners on `window`.
  - Every `KEEP_ALIVE_INTERVAL_MS` (4 min) it calls `postKeepAlive()`, but only when `document.visibilityState === 'visible'` and there was activity since the last ping.
  - Holds `idleExpiresAt` in state, falling back to `lastRefresh + 30 min` when the server says `null`.
  - On `visibilitychange` to visible, a past `idleExpiresAt` triggers one `/me` refetch and one keep-alive, so the 401 path takes over after a laptop sleep.
  - Timers clean up on sign-out and unmount.
  - Tabs share the deadline over a `BroadcastChannel` (`src/auth/session-channel.ts`): every renewal announces its `idleExpiresAt`, and each tab keeps the later of its own and what it hears. A tab another tab kept alive doesn't warn, and each tab still renews only for its own activity.
  - Sign-out is shared on the same channel. `logout()` announces `ended` once portal-api confirms the session is gone (not on a failed logout), and `useSessionEndedRedirect` announces it on this tab's first 401. Other tabs handle it as their own 401: clear the user, and send `_authenticated` pages to the BFF login. A tab that heard the news doesn't re-announce it.
- **New `src/components/session-timeout-dialog/`**: BCDS `AlertDialog` used as is (`@repo/design-system/components/alert-dialog`; no extension, so no `/dev` page, per the design-system README).
  - Opens at `idleExpiresAt − 2 min` with "You'll be signed out soon" and a countdown in minutes (`aria-live="polite"`, not per second).
  - **Stay signed in** runs `postKeepAlive()` and closes the dialog.
  - **Sign out** runs the existing `logout()` from `auth/api.ts`.
  - When the countdown reaches zero, it sets `me` to `null` and redirects if the route needs a session, the same as PR 1.
  - Mounted in `RootLayout` beside the hook.
  - Before shipping, check `src/csp-hashes.test.ts` passes: the dialog is react-aria and already in the pinned catalog.

Tests:

- bff-core `auth.controller.test.ts` / `token-refresh.service.test.ts`, with the fake IdP:
  - keep-alive on a fresh token makes no refresh and returns `idleExpiresAt`;
  - keep-alive on a token older than 60 s refreshes once, saves it and pushes `idleExpiresAt` forward;
  - `invalid_grant` gives 401 and a cleared cookie with the session row gone;
  - an IdP outage gives 503 with the session kept;
  - no session gives 401 with no cookie set;
  - the origin guard refuses a cross-origin POST.
- packages/auth `oidc-client.test.ts`: `refreshExpiresAt` and `obtainedAt` are mapped; `refresh_expires_in: 0` gives `null`.
- portal-web, with Vitest fake timers:
  - no ping when there's no activity;
  - one ping per interval while active;
  - no ping while hidden;
  - the dialog opens at `idleExpiresAt − 2 min`, Stay signed in pings and closes it, and reaching zero redirects on `/settings`;
  - returning to a tab after the idle deadline leads to the login redirect.

## Files

- PR 1:
  - new `apps/portal-web/src/api/http.ts`
  - new `apps/portal-web/src/auth/use-session-ended-redirect.ts`
  - `apps/portal-web/src/profile/api.ts`
  - `apps/portal-web/src/components/root-layout/index.tsx`
- PR 2:
  - `packages/auth/src/{types,oidc-client}.ts`
  - `packages/auth/src/test-support/fake-idp.ts`
  - `packages/bff-core/src/refresh/token-refresh.service.ts`
  - `packages/bff-core/src/auth/auth.controller.ts`
  - new `apps/portal-web/src/auth/{keep-alive,use-session-keep-alive}.ts`
  - new `apps/portal-web/src/components/session-timeout-dialog/`
- Plan record: copy this plan to `docs/plans/2026-11-26-<HHMM>-feat-session-keep-alive-plan.md` and commit it with the code.

## Verification

- `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (Turborepo covers auth, bff-core, portal-web).
- Locally (`compose.yaml`, `https://sdg.localhost`):
  - Sign in, open Settings, delete the session's tokens (or set `expiresAt` in the past with a revoked refresh token). The next profile load goes to Keycloak login and returns to `/settings`.
  - Set `KEEP_ALIVE_INTERVAL_MS` and the warning lead short through a dev-only override. Moving the mouse sends `POST /api/auth/keep-alive` every interval (network tab). Stopping opens the dialog. Stay signed in extends; leaving it lets it expire and redirect.
- On sdg-test after deploy: leave Settings idle for 30 min. Expect the warning at about 28 min and sign-in at 30, never the error alert.
