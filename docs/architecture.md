# Architecture

C4 diagrams of the Single Digital Gateway: system context, containers, the components of core-api and of the two BFFs, and the OpenShift deployment. Update them when a service, route group or dependency changes.

Colors: dark blue is a person, blue is part of SDG, light blue is a component inside a service, grey is an external system, and a dashed border means optional (off unless configured).

## Level 1: System context

Who uses SDG and which outside systems it depends on.

```mermaid
flowchart TB
  resident["<b>Resident</b><br/>Signs in with BC Services Card"]:::person
  console["<b>Console user</b><br/>Government staff, IDIR,<br/>with a console role"]:::person
  partner["<b>Partner system</b><br/>Service account registered<br/>by an administrator"]:::ext

  sdg["<b>Single Digital Gateway</b><br/>Resident portal, console app and<br/>read-only service gateway"]:::internal

  sso["<b>BC Gov SSO</b><br/>Keycloak loginproxy, standard realm<br/>BC Services Card and IDIR"]:::ext
  vault["<b>Vault</b><br/>Session and client secrets"]:::ext
  obs["<b>Observability stack</b><br/>Grafana LGTM + Alloy"]:::optional

  resident -->|"Uses the portal"| sdg
  console -->|"Manages service accounts"| sdg
  partner -->|"Reads data: GET + Bearer token"| sdg
  partner -->|"Gets tokens: client credentials"| sso
  sdg -->|"Signs people in, verifies every token"| sso
  sdg -->|"Reads secrets at pod start"| vault
  sdg -.->|"Metrics, logs, traces"| obs

  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  classDef internal fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef ext fill:#6b7685,stroke:#4b5563,color:#ffffff
  classDef optional fill:#6b7685,stroke:#4b5563,color:#ffffff,stroke-dasharray:6 4
```

- Residents and console users are always different people: the portal client uses BC Services Card and the console client uses IDIR.
- Partners never sign in. Their token is accepted only while their client is registered and enabled in SDG.

## Level 2: Containers

Six services plus the database. Hosts are `sdg-N`, `sdg-N-console` and `sdg-N-gateway` for pull request N, and `sdg-test…` and `sdg-prod…` for TEST and PROD.

```mermaid
flowchart TB
  resident["<b>Resident</b>"]:::person
  console["<b>Console user</b>"]:::person
  partner["<b>Partner system</b>"]:::ext

  subgraph SDG["Single Digital Gateway"]
    edge["<b>Edge</b><br/>Caddy + Coraza WAF<br/>Routes by host"]:::internal
    portalweb["<b>portal-web</b><br/>React SPA"]:::internal
    consoleweb["<b>console-web</b><br/>React SPA<br/>Service-account registry"]:::internal
    portalapi["<b>portal-api</b><br/>NestJS BFF on bff-core<br/>Cookie portal.sid"]:::internal
    consoleapi["<b>console-api</b><br/>NestJS BFF on bff-core<br/>Cookie console.sid"]:::internal
    gatewayapi["<b>gateway-api</b><br/>NestJS forwarder on server-core<br/>GET only, no session"]:::internal
    coreapi["<b>core-api</b><br/>NestJS<br/>Principals, registry,<br/>all authorization"]:::internal
    db[("<b>Postgres</b><br/>PGO cluster, database portal<br/>Schemas core, portal, console")]:::internal
  end

  sso["<b>BC Gov SSO</b>"]:::ext
  vault["<b>Vault</b>"]:::ext

  resident -->|"portal host"| edge
  console -->|"console host"| edge
  partner -->|"gateway host"| edge

  edge -->|"/ on portal host"| portalweb
  edge -->|"/api* on portal host"| portalapi
  edge -->|"/ on console host"| consoleweb
  edge -->|"/api* on console host"| consoleapi
  edge -->|"/api* on gateway host"| gatewayapi

  portalapi -->|"portal + shared routes,<br/>user's access token"| coreapi
  consoleapi -->|"console + shared routes,<br/>user's access token"| coreapi
  gatewayapi -->|"gateway routes,<br/>caller's Bearer token"| coreapi

  portalapi -->|"login portal: sessions"| db
  consoleapi -->|"login console: sessions"| db
  coreapi -->|"login core: principals, registry"| db

  portalapi -->|"OIDC sign-in, refresh, sign-out"| sso
  consoleapi -->|"OIDC sign-in, refresh, sign-out"| sso
  coreapi -->|"Signing keys, userinfo"| sso
  vault -.->|"Vault Agent: session + client secret"| portalapi
  vault -.->|"Vault Agent: session + client secret"| consoleapi

  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  classDef internal fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef ext fill:#6b7685,stroke:#4b5563,color:#ffffff
  style SDG fill:none,stroke:#1168bd,stroke-dasharray:6 4
```

- Routes have the shape `/api/v1/<audience>/…`. Each forwarder passes on only its own audiences and answers 404 to the rest without calling core-api.
- gateway-api checks only the request's shape: 401 without a Bearer token, 405 for anything but GET, 404 outside `/api/v1/gateway/*`.
- Each service has its own Postgres login and schema and can't read the others'. pg_cron prunes expired sessions. gateway-api has no database.
- On the gateway host the edge answers 404 to anything outside `/api*`. A host whose upstream isn't deployed answers 503.

## Level 3: core-api components

core-api trusts no forwarder. It verifies every token itself, then authorizes by audience.

```mermaid
flowchart TB
  bffs["<b>portal-api / console-api</b>"]:::internal
  gw["<b>gateway-api</b>"]:::internal
  sso["<b>BC Gov SSO</b>"]:::ext

  subgraph CORE["core-api"]
    guards["<b>Audience guards</b><br/>Shared, Console, Internal<br/>403 for the wrong kind of caller"]:::comp
    gguard["<b>GatewayGuard</b><br/>Client must be registered and enabled<br/>Read on every request, no cache"]:::comp
    resolver["<b>PrincipalResolver</b><br/>Verifies the JWT, classifies the caller:<br/>portal user, console user, service account<br/>401 invalid, 503 keys unreachable"]:::comp
    me["<b>MeController</b><br/>GET /api/v1/shared/me"]:::comp
    principals["<b>Principals</b><br/>POST /internal/principals/login<br/>Userinfo, upsert, admin role check"]:::comp
    regconsole["<b>Registry console controller</b><br/>/api/v1/console/service-clients<br/>List, history, add, disable, enable, remove"]:::comp
    reggw["<b>Registry gateway controller</b><br/>GET /api/v1/gateway/me"]:::comp
    regsvc["<b>RegistryService</b><br/>Each change and its history event<br/>in one transaction"]:::comp
    userinfo["<b>UserinfoClient</b>"]:::comp
  end

  db[("<b>core schema</b><br/>principals, identities,<br/>service_clients, service_client_events")]:::internal

  bffs --> guards
  gw --> gguard
  guards --> resolver
  gguard --> resolver
  resolver -->|"Signing keys"| sso
  guards --> me
  guards --> principals
  guards --> regconsole
  gguard --> reggw
  regconsole --> regsvc
  reggw --> regsvc
  gguard -->|"Looks up azp"| regsvc
  principals --> userinfo
  userinfo --> sso
  me --> db
  principals --> db
  regsvc --> db

  classDef internal fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef comp fill:#85bbf0,stroke:#5d82a8,color:#0b2340
  classDef ext fill:#6b7685,stroke:#4b5563,color:#ffffff
  style CORE fill:none,stroke:#1168bd,stroke-dasharray:6 4
```

- A person token is accepted only from the portal or console client. Service-account tokens are recognized by their `client_id` claim or `service-account-` username, and the registry is matched on `azp`.
- `/internal/*` is never forwarded. Only the BFFs call it, at sign-in. A refused console user gets 403 there, and console-api turns that into a sign-out.
- The portal audience has no routes yet. Residents use only the shared `/me` route so far.

## Level 3: BFF components

portal-api and console-api are the same `@repo/bff-core` module with different settings (cookie, client, schema, audiences). Only console-api adds the refusal hook.

```mermaid
flowchart TB
  spa["<b>portal-web / console-web</b><br/>in the browser"]:::internal
  sso["<b>BC Gov SSO</b>"]:::ext
  core["<b>core-api</b>"]:::internal

  subgraph BFF["portal-api / console-api"]
    origin["<b>OriginGuard</b><br/>Non-GET requests need<br/>the app's own Origin"]:::comp
    auth["<b>AuthController</b><br/>/api/auth/login, callback, me, logout"]:::comp
    login["<b>core-api login hook</b><br/>Upserts the principal at sign-in"]:::comp
    refusal["<b>Refusal hook</b> (console-api)<br/>Ends the Keycloak session,<br/>redirects to /not-authorized"]:::comp
    sessguard["<b>SessionAuthGuard</b>"]:::comp
    refresh["<b>TokenRefreshService</b><br/>Refreshes near expiry,<br/>re-reads the session across pods"]:::comp
    forward["<b>BffForwardController</b><br/>Allow-listed audiences only,<br/>404 otherwise; core-api 401 ends the session"]:::comp
    store["<b>PostgresSessionStore</b><br/>Tokens encrypted with SessionCipher,<br/>sign-out leaves a tombstone"]:::comp
  end

  db[("<b>portal or console schema</b><br/>sessions")]:::internal

  spa --> origin
  origin --> auth
  origin --> sessguard
  auth -->|"Code flow, end session"| sso
  auth --> login
  login -->|"POST /internal/principals/login"| core
  login -.->|"403 from core-api"| refusal
  refusal --> sso
  sessguard --> refresh
  refresh -->|"Refresh token"| sso
  sessguard --> forward
  forward -->|"User's access token"| core
  auth --> store
  refresh --> store
  store --> db

  classDef internal fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef comp fill:#85bbf0,stroke:#5d82a8,color:#0b2340
  classDef ext fill:#6b7685,stroke:#4b5563,color:#ffffff
  style BFF fill:none,stroke:#1168bd,stroke-dasharray:6 4
```

- The browser never sees a token, only the session cookie. The BFF attaches the access token when it forwards.
- A failed sign-in redirects to the app with `?authError=` (`unavailable`, `login_failed`, `access_denied`, `invalid_state`) and keeps any existing session.

## Deployment: OpenShift

GitHub Actions deploys the `charts/sdg` Helm umbrella as one release per environment, with images from GHCR.

```mermaid
flowchart LR
  gha["<b>GitHub Actions</b><br/>PR open, merge, release"]:::ext
  ghcr["<b>GHCR</b><br/>8 images"]:::ext

  subgraph NS["Namespace d62e77-dev (PRs), -test, -prod"]
    routes["<b>Routes</b><br/>portal, console, gateway hosts"]:::internal
    edgep["<b>edge</b> pods"]:::internal
    webs["<b>portal-web, console-web</b> pods"]:::internal
    bffp["<b>portal-api, console-api</b> pods<br/>+ Vault Agent, migrate initContainer"]:::internal
    gwp["<b>gateway-api</b> pods"]:::internal
    corep["<b>core-api</b> pods<br/>+ migrate initContainer"]:::internal
    pg[("<b>PostgresCluster</b> (PGO)<br/>pgBackRest backups")]:::internal
  end

  subgraph OBS["d62e77-tools (dev + test) / d62e77-prod"]
    alloy["<b>Observability release</b><br/>Alloy, Grafana LGTM, Prometheus"]:::optional
  end

  vault["<b>Vault</b><br/>role d62e77-nonprod / -prod"]:::ext

  gha -->|"helm upgrade --install"| NS
  ghcr -->|"Pulls images"| NS
  routes --> edgep
  edgep --> webs
  edgep --> bffp
  edgep --> gwp
  bffp --> corep
  gwp --> corep
  bffp --> pg
  corep --> pg
  vault -.-> bffp
  alloy -.->|"Scrapes, receives OTLP"| NS

  classDef internal fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef ext fill:#6b7685,stroke:#4b5563,color:#ffffff
  classDef optional fill:#6b7685,stroke:#4b5563,color:#ffffff,stroke-dasharray:6 4
  style NS fill:none,stroke:#1168bd,stroke-dasharray:6 4
  style OBS fill:none,stroke:#6b7685,stroke-dasharray:6 4
```

- Every PR gets the full stack, sized down, as release `sdg-N` in the dev namespace. TEST and PROD are `sdg-test` and `sdg-prod`.
- Ingress NetworkPolicies separate the tiers: the edge accepts only the OpenShift router, the web apps and forwarders accept only the edge, core-api accepts only the three forwarders, and Postgres accepts only core-api and the two BFFs.
- The release rolls back as a whole: if one service fails to start, none of the new versions stay.
- Observability is wired only when `OBSERVABILITY=true`. Otherwise nothing is scraped or sent.
