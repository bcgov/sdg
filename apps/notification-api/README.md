# notification-api

A spike of the platform's shared notification service (plan: `docs/plans/2026-11-04-1302-feat-notification-api-plan.md`). Authorized systems send Notification types from an admin-curated catalog to portal users, people who haven't signed in yet, raw email addresses and other systems, over in-app, email and webhook. Delivery follows each type's policy (all at once, or escalation that an in-app read cancels), the recipient's language and quiet hours, and every send can be found again in history.

NestJS on TypeScript 6, its own `notification` database in the shared Postgres (tables in its `notification` schema; schema and drizzle migrations in `packages/notification-database`), Keycloak bearer tokens. API docs at `/api/docs` outside production.

## Who calls it

| Token                                                     | Endpoints                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A person, on this service's own client, with `admin` role | `/api/v1/admin/*`: senders, types, templates, layouts, topics, history               |
| A sender's owner, on this service's own client            | `/api/v1/senders/:id/*`: credentials and scopes, integrations, callback              |
| A linked service-account client (a sender credential)     | send, sender topics, recipients, history                                             |
| A person, relayed by portal-api (`RELAYING_CLIENT_IDS`)   | `/api/v1/me/*`: settings, contact points, subscriptions, inbox                       |
| Nobody                                                    | `POST /api/v1/contact-points/confirm`, `/healthz/live`, `/healthz/ready`, `/metrics` |

portal-api relays `/api/v1/notifications/*` to `/api/v1/me/*` with the signed-in user's token, plus the public confirm route that portal-web's `/confirm-email` page calls. A site that signs in with PKCE can instead call `/api/v1/me/*` from the browser (the header's direct mode): its client id goes in `RELAYING_CLIENT_IDS` and its origin in `CORS_ALLOWED_ORIGINS`.

## Inbox

The user's in-app items, under `/api/v1/me/inbox` (through portal-api: `/api/v1/notifications/inbox`). The `<sdg-header>` bell and portal-web's inbox pages use them:

| Request                                     | Answer                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET inbox?limit=&cursor=&unread=true`      | `{ items, nextCursor }`, newest first; `unread=true` lists only unread items. Each item has a plain-text `excerpt` of its body (at most 140 characters)     |
| `GET inbox/unread-count`                    | `{ unread }`                                                                                                                                                |
| `GET inbox/by-notification/:notificationId` | The user's item for that notification, left unread. 404 when there is none, also when the notification is someone else's                                    |
| `POST inbox/:itemId/read`                   | The item, read; its pending escalation steps are cancelled. Reading again keeps the first read time                                                         |
| `POST inbox/read-all`                       | `{ marked }`: every item unread when the request runs is read and its pending escalation steps are cancelled                                                |
| `GET inbox/stream`                          | Server-Sent Events: `event: changed` (no content) whenever the user's inbox changes, a `: keep-alive` comment every 15 seconds; ends when the token expires |

Every inbox write sends one Postgres `NOTIFY`; each api-role instance LISTENs and signals its own open streams, so the stream works with several instances. Clients refetch through the other requests on each `changed`. The stream and its relayed copy are left out of request logs and latency metrics.

CORS (direct mode) applies only to `/api/v1/me/*`, for the origins in `CORS_ALLOWED_ORIGINS`: `GET` and `POST`, the `authorization`, `content-type` and `sdg-background` request headers, no cookies. An unlisted origin gets no `access-control-allow-origin`, and other paths get no CORS headers.

## Roles

`NOTIFICATION_ROLE` picks what a process runs: `api` (routes, health, metrics), `worker` (the delivery loop: expand, plan, deliver, failure callbacks; health and metrics only) or `all` (both; the default, and what compose runs). Workers claim work with `FOR UPDATE SKIP LOCKED`, so any number can share a database.

## Template variables

Templates (Liquid, every channel) see the sender's `data` fields by name, plus two variables the platform sets. Their names are reserved: a type's data contract can't define a top-level `notification` or `recipient` property (creating the type answers 400), though nested properties can use them:

| Variable             | Value                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `notification.id`    | The notification's id: the one the send returned, and what the portal inbox links to        |
| `recipient.hasInbox` | `true` only for a portal user; `false` for address and system recipients, who have no inbox |

There is no portal URL setting, so a template writes the link itself and guards it, because an address recipient has no inbox page to open:

```liquid
{% if recipient.hasInbox %}https://<portal>/inbox/{{ notification.id }}{% endif %}
```

Previews and the test renders on save use a sample id and `hasInbox: true`.

## Environment

Every key is in `.env.example` with a comment; `src/config/env.ts` validates them at boot. The ones you must set:

- `KEYCLOAK_ISSUER_URL`, `NOTIFICATION_CLIENT_ID`: the realm and this service's own client.
- `RELAYING_CLIENT_IDS`: portal-api's client id, so relayed user tokens are accepted, and the client id of each direct-mode site.
- `NOTIFICATION_ENCRYPTION_KEY`: 32+ random characters (`openssl rand -base64 48`); seals stored integration secrets.
- `DATABASE_URL`: from the host, `postgres://portal:portal@localhost:5432/notification`. compose overrides it, and the SMTP, outbound allow-list and confirm-page settings, for the container.

`CORS_ALLOWED_ORIGINS` is optional: exact origins whose pages may call `/api/v1/me/*` directly (empty: no CORS). compose sets `http://localhost:5173`, a host Vite dev server.

The keys under "Local scripts only" are read by `scripts/login.ts`, `seed.ts` and `e2e.ts`, never by the app.

## Running locally

The root `compose.yaml` runs it with the rest of the stack (DEVELOPER.md, Local Stack):

```sh
cp apps/notification-api/.env.example apps/notification-api/.env   # then fill in the keys above
podman compose up -d --build
```

| Service                | What                                                                                                              | From the host                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `notification-migrate` | builds `@repo/notification-database`, creates the `notification` database when missing and applies its migrations | —                              |
| `notification-api`     | `nest start --watch`, `all` role                                                                                  | `https://notify.sdg.localhost` |
| `mailpit`              | catches all email (SMTP `mailpit:1025` inside the network); the platform default SMTP                             | `http://localhost:8025`        |
| `webhook-receiver`     | `scripts/webhook-receiver.ts`: records every webhook and callback (`GET /requests`)                               | `http://localhost:8090`        |

Only Mailpit and the webhook receiver are on notification-api's outbound allow-list (`NOTIFICATION_OUTBOUND_ALLOW_HOSTS`), so plain HTTP and SMTP without TLS work for them and nothing else. `pnpm stack:trust` once makes `https://notify.sdg.localhost` trusted; the scripts run Node with `--use-system-ca`. If Node still rejects the certificate, point `NODE_EXTRA_CA_CERTS` at Caddy's root (`podman cp portal_caddy_1:/data/caddy/pki/authorities/local/root.crt caddy-root.crt`).

Without compose: `pnpm --filter @repo/notification-database build`, then `DATABASE_URL=… node packages/notification-database/dist/migrate.js` from the repo root, then `pnpm --filter notification-api dev` (port 3000).

One-off reset after the move to `packages/notification-database`: the tables now live in the `notification` schema, and the migrations restart from a fresh baseline that an older local `notification` database does not match. If you ran notification-api locally before, drop that database once (`podman compose exec postgis dropdb -U portal --force notification`, then restart `notification-migrate`), or reset the whole stack with `podman compose down -v`.

## Keycloak setup for the scripts

Both in the realm `KEYCLOAK_ISSUER_URL` names. Each deployed environment has its own issuer (dev, test or prod loginproxy), so each needs its own (DEVELOPER.md, Checklist step 9):

- On notification-api's client: an `admin` client role assigned to you, and `http://localhost:8400/callback` (or your `NOTIFICATION_LOGIN_PORT`) as a valid redirect URI. Set `NOTIFICATION_CLIENT_SECRET` if the client is confidential.
- Two service-account clients whose tokens carry an audience notification-api accepts: their ids and secrets go in `SENDER_CREDENTIAL_A_*` and `SENDER_CREDENTIAL_B_*`.

## Login, seed, send and the end-to-end run

```sh
# An admin token (stdout only; short-lived). Opens the browser for the sign-in.
export NOTIFICATION_ADMIN_TOKEN="$(pnpm --filter notification-api --silent admin-token)"

# Three types with en-CA/fr-CA templates, a self-subscribe platform topic, a sender you own that may broadcast to it,
# both credentials linked and scoped, and a failure callback to the webhook receiver when WEBHOOK_RECEIVER_INTERNAL_URL
# is set. Creates only what is missing: run it again to finish a failed run; after a full seed it changes nothing.
# Prints the sender and platform topic ids.
pnpm --filter notification-api seed

# One `permit-status` notification as credential A: to a topic (e.g. the platform topic id seed printed), or to one
# user by the issuer and subject of their token. Prints the notification id.
pnpm --filter notification-api send --topic <topic id>
pnpm --filter notification-api send --issuer <iss> --subject <sub>

# The end-to-end run. DROPS and re-migrates the local notification database, seeds it, then checks every flow.
pnpm --filter notification-api e2e
```

`seed` and `send` print the base URL and issuer they act on (stderr) before their first write, and `admin-token` the issuer and client it signs in to. `send` without `--topic`, or without both `--issuer` and `--subject`, prints its usage and exits 1 before calling anything.

Without `NOTIFICATION_ADMIN_TOKEN`, `seed` and `e2e` sign you in through the browser themselves and refresh the token while they run, which `e2e` (about three and a half minutes) needs if the realm's tokens are short-lived.

Before `e2e`, sign in at `https://sdg.localhost` with BC Services Card and copy the `portal.sid` cookie's value (browser dev tools) into `PORTAL_SESSION_COOKIE`; that identity needs a verified email at the IdP. The relayed calls (F3, F6, F1, I1) use that session, and their sends address the portal user, whose issuer and subject `e2e` reads from the local database. The admin token (IDIR) is a separate identity.

`e2e` prints one line per check and exits 1 if any fails:

| Check | What it proves                                                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5    | Two linked credentials, one scoped to `form-received`; a `permit-status` send through it is 403                                                                                                                                                                                                                                                         |
| F2    | A raw address gets the fr-CA email through the platform default; history finds it by address and by form reference                                                                                                                                                                                                                                      |
| F4    | An invalid `smtp` config is 400; the saved password is never returned or stored in clear; the sender's email uses it                                                                                                                                                                                                                                    |
| F3    | Through the portal: a new address is unverified, the Mailpit link confirms it, then it receives a send                                                                                                                                                                                                                                                  |
| F6    | A sender topic (you and a system) and the platform topic (you subscribe yourself) reach email, in-app and webhook                                                                                                                                                                                                                                       |
| F1    | Escalation: reading the in-app item cancels the email step; the unread one is emailed after the one-minute delay                                                                                                                                                                                                                                        |
| W2    | A second worker-role process runs in the notification-api container (`E2E_COMPOSE exec`); 30 webhook deliveries each reach the receiver exactly once                                                                                                                                                                                                    |
| I1    | Through the portal and the compose edge: the relayed stream gets `changed` within 2 s of a send and stays open 31 s on keep-alives; opening a notification by its id and reading it cancels its email reminder; an email links to `/inbox/<notification id>`; the CORS preflight to `notify.sdg.localhost` is allowed from `http://localhost:5173` only |

I1 runs last because it saves a new version of the `permit-status` email templates (the inbox link). The run is manual: CI runs only the unit and integration tests (`pnpm --filter notification-api test`).

## Running against a deployed environment

Every `sdg` release runs notification-api (`charts/README.md`, notification-api). Outside the cluster it answers at `https://<release>-notify.apps.<cluster domain>`, e.g. `https://sdg-12-notify.apps.gold.devops.gov.bc.ca` for PR 12 (the PR comment links it) and `https://sdg-test-notify.apps.gold.devops.gov.bc.ca` for TEST. Only `/api` is public there; `/metrics` and `/healthz` are not, and `/api/docs` is off in production.

Point the script settings at that environment, in `.env` or in the shell (the shell wins):

- `NOTIFICATION_API_BASE_URL`: the notification host above.
- `KEYCLOAK_ISSUER_URL`, `NOTIFICATION_CLIENT_ID`, `NOTIFICATION_CLIENT_SECRET`: that environment's realm and client. The loginproxy differs per environment (`dev.loginproxy.gov.bc.ca` for PRs, `test.loginproxy.gov.bc.ca` for TEST), and so does each client's secret.
- `SENDER_CREDENTIAL_A_*`, `SENDER_CREDENTIAL_B_*`: the two service-account clients in that realm, with that realm's secrets.
- `WEBHOOK_RECEIVER_INTERNAL_URL`: blank. A deployed environment has no webhook receiver, so the seed sets no failure callback.

Then, in order:

1. Get a fresh `NOTIFICATION_ADMIN_TOKEN` with `admin-token` from that realm (you need the `admin` role on its notification-api client; a token from another realm is rejected) and run `seed`. Check the URL and issuer it prints first. If it fails partway, run it again.
2. Portal inbox: sign in to the environment's portal with BC Services Card and subscribe to the seed's platform topic through portal-api's relay. portal-web has no page for that yet, so run `await fetch('/api/v1/notifications/subscriptions/<platform topic id>', { method: 'PUT' })` in the browser console on the portal (204). Then `send --topic <platform topic id>`: the notification appears in the bell and the inbox without a reload.
3. Direct mode: the tester's page signs in with its own client in the same realm, and that client and the page's origin must be in the environment's relaying clients and CORS origins (`NOTIFICATION_PR_*` for PRs, the `test` environment's variables for TEST; DEVELOPER.md, GitHub). Read `iss` and `sub` from the page's own access token and `send --issuer <iss> --subject <sub>`.

A person's BC Services Card subject probably differs from one client to the next, so the portal and a direct-mode site may see different inboxes for the same person. Direct mode shows the inbox of the identity the site signs in as, which is why step 3 addresses that identity rather than the portal user.

No platform default email server is configured in deployed environments, so `permit-status`'s email step fails and is recorded in the notification's history, while the in-app item is delivered. A sender can add its own email integration. `e2e` is local only: it resets the database through compose and needs Mailpit and the webhook receiver.
