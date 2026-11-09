# ADR 0002: A shared notification-api service, with the inbox in the shared header

- **Status:** Proposed
- **Date:** 2026-11-09
- **Deciders:** SDG portal team
- **Product team:** SDG portal
- **Related:** `docs/plans/2026-11-04-1302-feat-notification-api-plan.md`,
  `docs/plans/2026-11-05-1632-feat-portal-inbox-plan.md`, `apps/notification-api`, `packages/sdg-header`,
  ADR 0001 (telemetry the new service reuses)

## Context

The portal needs to tell its users things, and systems owned by other teams will too, some of them outside this repo.
Nothing on the platform sends notifications today.

If each system builds its own sending, the platform ends up with several inboxes, several email setups and no shared
record of what was said to whom. Nobody controls what gets sent, and a member of the public who gave an email address on
a form has no communication history anyone can look up.

Delivery needs vary:

- Some messages should escalate from in-app to email when they are ignored.
- Some recipients are systems that want webhooks.
- Some programs must send through their own mail infrastructure.
- Recipients have a language, a time zone and quiet hours.

Users also need somewhere to read in-app notifications. The shared `<sdg-header>` is used by sites this team does not
build, including from a CDN, so whatever the portal gets should work for them without each site building it again.

Constraints:

- BC Gov Gold, with Postgres already on the platform and no Valkey or Redis.
- Sign-in through the BC Gov SSO (Keycloak) standard realm: portal users through BC Services Card, staff through IDIR.
- The edge route uses the router's default certificate, so browsers talk HTTP/1.1 to it (six connections per host), and
  HAProxy closes connections idle for 30 seconds.
- Production CSP has no `'unsafe-inline'` styles.

The design was proved in a local spike (`spike/notification-api`, not pushed): 13 implementation units for the service
and 13 for the inbox, with an end-to-end run against real SSO passing.

## Decision

We will send the platform's notifications through one shared service, `notification-api`, in this monorepo, and show
in-app notifications through a self-contained bell and inbox popover in `<sdg-header>`.

- **Service.** A NestJS 12 app with `api` and `worker` roles over its own Postgres database. The delivery rows are the
  queue (`FOR UPDATE SKIP LOCKED` with leases). Delivery is at least once, with a stable delivery ID receivers can
  deduplicate on.
- **What can be sent.** An admin curates a catalog of Notification types: a data contract, Liquid templates (MJML for
  email HTML) per channel and language, and a delivery policy. The admin grants types to senders; a sender's
  credentials (Keycloak service-account clients) send them to recipients, topics or the sender's whole audience.
- **Channels.** In-app, email and webhook, each through pluggable integration types (SMTP is the first email type).
  Every notification to a user also creates an in-app item, which is the complete record; reading it stops pending
  escalation steps.
- **Recipients.** notification-api keeps its own recipient registry keyed by IdP issuer and subject, plus address-only
  recipients per sender.
- **Users' calls.** Users reach their own `/api/v1/me/*` endpoints with their own token: through a relay on the host
  app's origin that uses its session (portal-api), or directly with a browser-held token from origins on a CORS
  allow-list.
- **Live updates.** Each inbox write sends a Postgres `NOTIFY`; every api instance listens and pushes an "inbox changed"
  signal over Server-Sent Events with a 15-second keep-alive. The signal carries no content; clients refetch through the
  normal endpoints.
- **Header.** `<sdg-header>` draws the bell, badge and popover and loads its own data from a configured source, holding
  one live connection per browser (a Web Lock picks the leader tab, a `BroadcastChannel` passes signals to the rest).
  Sites turn it on with configuration only.
- **Sign-in.** Background traffic (the live connection and the refreshes it triggers) never extends a portal session;
  an idle session ends after `SESSION_TTL_SECONDS`, and so does its Keycloak session.

## Options considered

### Option 1: A shared notification-api in this monorepo (chosen)

- Pros: one record of what was sent to whom; one place to control what can be sent; escalation, quiet hours and
  language handled once; other teams' systems send through a documented API; reuses the portal's stack, Postgres and
  telemetry.
- Cons: a new service to run, secure and keep available; other teams depend on this team for catalog changes.

### Option 2: Each app sends its own notifications

- Pros: no shared service; each team moves at its own pace.
- Cons: several inboxes and mail setups; no shared history or control over content; escalation from in-app to email
  is impossible across apps; every team rebuilds templates, retries and preferences.

### Option 3: Notifications inside portal-api

- Pros: no new deployable; the portal session is already there.
- Cons: other teams' systems would have to call the portal's backend; delivery work would compete with portal requests;
  hard to split out later.

### Option 4: A hosted third-party notification service

- Pros: no delivery engine to build or run.
- Cons: recipient data and message history leave the platform; the in-app inbox, escalation on in-app read and the
  shared header still have to be built here; ties senders to the vendor's model and pricing.

### Live updates: alternatives

- **Fast polling** of an unread count: simplest, but not real time, and load grows with open tabs.
- **portal-api holding the browser connections**, told by notification-api what changed: only the portal benefits.
- **WebSockets**: two-way, which nothing needs, and harder to pass through the relay than a plain HTTP stream.
- **One stream per tab**: a few tabs would use up the six HTTP/1.1 connections per host and stall the site.

## Consequences

- **Positive:** one inbox and one history across the platform; reading in the portal stops reminder emails; any site
  using the header gets the inbox from configuration; live updates need no Redis and no OpenShift route changes.
- **Negative:**
  - Another service, database and worker to operate, plus one dedicated Postgres connection per api instance for
    `LISTEN`.
  - Long-lived HTTP connections on notification-api and portal-api pods, which drain on shutdown.
  - The header's CDN bundle grows from about 49 kB to about 71 kB (24 kB gzipped).
  - `SESSION_TTL_SECONDS` becomes an idle limit, so a portal tab left open signs the user out after it.
  - Direct mode puts an access token in the host site's JavaScript, where an XSS bug could steal it; each site makes
    that choice.
- **Follow-up work (before production):**
  - Unsubscribe for email, and anti-spam safeguards for sends to raw public addresses.
  - A Helm chart, NetworkPolicies and an edge route for notification-api, including a public route for direct mode.
  - An admin UI for the catalog, senders and credentials.
  - A decision on how the spike reaches `main`.

## Notes

- Deferred channels and features: SMS, push and web push; digests; muting and a mandatory flag; event-routed sends.
- The direct-mode header needs the site's Keycloak client in `RELAYING_CLIENT_IDS` and its origin in
  `CORS_ALLOWED_ORIGINS`.
- Revisit the live-update design if a connection pooler (for example PgBouncer in transaction mode) is put in front of
  Postgres, since `LISTEN` needs a direct connection.
