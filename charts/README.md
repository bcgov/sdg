# Helm charts

Deploy the portal to Kubernetes/OpenShift. Deploy workflows: DEVELOPER.md, Workflows.

| Chart              | Deploys                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`           | Library: names (`<release>-<chart>`), labels, image refs, restricted-SCC security contexts, Vault and database helpers, the notification host                               |
| `portal-web`       | The SPA on Caddy (:8080)                                                                                                                                                    |
| `portal-api`       | The NestJS BFF (:3000), with the `portal-database` migrator as an initContainer                                                                                             |
| `notification-api` | The shared notification service (:3000): an `api` and a `worker` Deployment, or one combined pod in PRs, each with the `notification-database` migrator as an initContainer |
| `edge`             | Caddy + Coraza WAF (:3000; metrics :3003 on `<release>-edge-metrics`) and the Ingress for the portal and notification hosts                                                 |
| `postgres`         | A Crunchy PGO `PostgresCluster` (PostgreSQL 17, PostGIS 3.5) with users and databases `portal` and `notification`                                                           |
| `sdg`              | Umbrella: all of the above in one release (`<chart>.enabled` toggles each)                                                                                                  |
| `observability`    | Separate release: Grafana, Prometheus, Loki, Tempo and Alloy in `<plate>-tools` / `<plate>-prod` (doc 20)                                                                   |

Only standard Kubernetes objects are used, apart from Crunchy's `PostgresCluster` and the Vault Agent annotations. The edge Ingress carries `route.openshift.io/termination: edge`, so OpenShift creates an edge-TLS Route from it, and `haproxy.router.openshift.io/disable_cookies: "true"`, so the router sets no sticky-session cookie (the edge is stateless).

## Prerequisites

- The Crunchy Postgres operator (PGO v5) watching the namespace.
- A Vault KV v2 secret holding `SESSION_SECRET` (≥ 32 chars, e.g. `openssl rand -base64 48`) and `KEYCLOAK_CLIENT_SECRET`, a Vault role that can read it, and the service account that role trusts (BC Gov: `<plate>-vault`). Values must not contain `'` or newlines.
- A second Vault KV v2 secret, for notification-api, holding `NOTIFICATION_ENCRYPTION_KEY` (≥ 32 chars, same rules), readable by the same role. Each environment has its own (DEVELOPER.md, Vault).
- Images `portal-web`, `portal-api`, `portal-database`, `notification-api`, `notification-database` and `edge` pushed as `<registry>/<name>:<tag>`.

## Install

```sh
helm dependency build charts/portal-web   # likewise portal-api, notification-api, edge, postgres, then:
helm dependency build charts/sdg
helm upgrade --install sdg-12 charts/sdg -n abc123-dev \
  --set global.image.registry=ghcr.io/<owner>/sdg \
  --set global.image.tag=12 \
  --set global.host=sdg-12.apps.silver.devops.gov.bc.ca \
  --set portal-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set portal-api.keycloak.clientId=<client> \
  --set portal-api.vault.role=abc123-nonprod \
  --set portal-api.vault.secretPath=abc123-nonprod/portal-api \
  --set portal-api.vault.serviceAccountName=abc123-vault \
  --set notification-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set notification-api.keycloak.clientId=<notification-api client> \
  --set notification-api.keycloak.relayingClientIds=<client> \
  --set notification-api.vault.role=abc123-nonprod \
  --set notification-api.vault.secretPath=abc123-nonprod/notification-api \
  --set notification-api.vault.serviceAccountName=abc123-vault
```

Without Vault, create a Secret with `SESSION_SECRET` and `KEYCLOAK_CLIENT_SECRET` and pass `--set portal-api.vault.enabled=false --set portal-api.existingSecret=<name>`; for notification-api, a Secret with `NOTIFICATION_ENCRYPTION_KEY` and `--set notification-api.vault.enabled=false --set notification-api.existingSecret=<name>`. The deploy workflows derive all of these with `scripts/deploy-values.sh`.

Environment sizes live in `charts/sdg/values-{pr,test,prod}.yaml`. PR environments are throwaway: `postgres.backups.enabled: false` (no pgBackRest), smaller requests, notification-api as one pod running both roles (`mode: combined`) and `strategy: { type: Recreate }` on portal-web, portal-api, notification-api and edge, so a PR takes about 85m CPU, 480Mi memory and 256Mi of PVC. Check what that leaves in a shared PR namespace with `oc describe quota -n <plate>-dev`; a deploy that doesn't fit fails. `postgres.parameters` go to Patroni; Postgres keeps about `max(max_wal_size, wal_keep_size)` of WAL, so keep both at about a quarter of `postgres.instances.storage` or less (`max_wal_size` 256MB default, 96MB TEST, 64MB PR; `wal_keep_size` Patroni's 128MB, 32MB TEST, 16MB PR).

On first install portal-api and notification-api pods wait (`CreateContainerConfigError`) until PGO has created their user Secrets (`<release>-postgres-pguser-portal`, `-pguser-notification`); the migrators then retry until the database accepts connections. On an existing cluster, PGO adds the `notification` user, database and Secret on upgrade, with no step by hand: notification-api keeps its tables in its own `notification` schema, which its user may create.

The postgres chart preloads pg_cron (`postgres.parameters`), and its init SQL installs the extension and grants the app user the `cron` schema. portal-database's migrations then schedule the jobs as that user, for example deleting expired sessions every 15 minutes (`SELECT jobname, schedule FROM cron.job;`). PGO runs the init SQL only when it creates a cluster. A cluster created before this was added needs two steps by hand, and its migrations fail until both are done. First, after the parameter change rolls out, check `SHOW shared_preload_libraries;` and restart the cluster if pg_cron isn't listed yet (`patronictl restart`). Second, as superuser on the primary, run `psql -d portal -c 'CREATE EXTENSION IF NOT EXISTS pg_cron; GRANT USAGE ON SCHEMA cron TO portal;'`.

## notification-api

notification-api is part of every `sdg` release, PR, TEST and PROD, with no switch per environment. portal-api reaches it inside the cluster (`portal-api.notificationApiUrl`, default `http://<release>-notification-api:3000`). Outside callers (direct-mode pages, the admin scripts, senders) use its own host, which `common.notifyHost` derives from `global.host` by appending `-notify` to the first DNS label: `sdg-12.apps.gold.devops.gov.bc.ca` becomes `sdg-12-notify.apps.gold.devops.gov.bc.ca`. One label keeps it under the router's default wildcard certificate, so there is no vanity hostname or custom certificate for it, and there is no override, because the WAF matches that shape. The edge Ingress carries both hosts on one `tls: [{}]`; if you set `edge.ingress.tls.secretName`, that certificate must cover both.

On the notification host the edge (`notify_on` in `apps/portal-web/caddy/common.caddy`) sends only `/api*` to notification-api and answers 404 for everything else, so `/metrics` and `/healthz` stay inside the cluster, as they do for portal-api. Every API route still checks its own token and role. Two WAF rules in `apps/portal-web/caddy/coraza.conf` apply to that host only:

- Rule 1011 lets browser CORS preflight (`OPTIONS`) through on paths under `/api/v1/me/`, the only ones notification-api answers CORS on. `OPTIONS` stays blocked on every other host and path, and `TRACE` and `TRACK` everywhere.
- Rule 1010 leaves request headers and bodies out of the audit log, because bearer tokens and integration secrets travel in them.

The Deployments (`mode: split` in TEST and PROD: api with RollingUpdate, worker with Recreate) each run the `notification-database` migrator first; an advisory lock lets one migrator apply the migrations while the others wait. No platform default email server (`DEFAULT_SMTP_*`) is configured: for a sender without an email integration of its own, email steps fail and are recorded in its history, and in-app delivery is unaffected. Senders may add their own email integrations.

## Observability

`charts/observability` is installed on its own as release `observability` by `.github/workflows/observability.yml`: in `<plate>-tools` (`values-tools.yaml`; collects from `<plate>-dev` and `<plate>-test`) and in `<plate>-prod` (`values-prod.yaml`; its own namespace only). Its configs are `charts/observability/files/`, shared with `compose.observability.yaml`. Only Grafana has an Ingress, with Keycloak login; users need the `admin`, `editor` or `viewer` client role.

The app charts report to it through `global.observability` (`collectorHost`, `scraperNamespace`, `environment`), which `scripts/deploy-values.sh` fills in when the `OBSERVABILITY` variable is `true`. Left empty, nothing is rendered. Set, portal-api and notification-api get `OTEL_*` env, the edge turns `/collect` on, their pods and the edge's get `sdg.gov.bc.ca/scrape*` annotations and a NetworkPolicy rule for the stack's Alloy, and Alloy may scrape them. Alloy's read-only pod discovery (Role and RoleBinding `observability-discovery`) is made once per namespace by a person with `scripts/setup-openshift.sh --observability --apply`; the deploy account can't manage RBAC.

## Where configuration lives

| Kind                                                                                                            | Where                                                             |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Plain config (`APP_URL`, Keycloak issuer/client id, log level, …)                                               | values → ConfigMap                                                |
| notification-api's `RELAYING_CLIENT_IDS`, `CORS_ALLOWED_ORIGINS`, `CONFIRM_EMAIL_URL`, `NOTIFICATION_CLIENT_ID` | values → ConfigMap                                                |
| `DATABASE_URL`                                                                                                  | Secret `<release>-postgres-pguser-portal` (created by PGO)        |
| notification-api's `DATABASE_URL`                                                                               | Secret `<release>-postgres-pguser-notification` (created by PGO)  |
| `SESSION_SECRET`, `KEYCLOAK_CLIENT_SECRET`                                                                      | Vault → `/vault/secrets/portal-api.env` → `node --env-file`       |
| `NOTIFICATION_ENCRYPTION_KEY`                                                                                   | Vault → `/vault/secrets/notification-api.env` → `node --env-file` |

## Test

```sh
helm plugin install https://github.com/helm-unittest/helm-unittest   # once (Helm 4: add --verify=false)
brew install kubeconform                                             # once
pnpm test:charts
```

`scripts/charts-test.sh` builds dependencies, runs `helm lint --strict` on every chart and the helm-unittest suites in each chart's `tests/`, checks that a disabled subchart renders nothing, and validates the rendered umbrella with kubeconform (`KUBERNETES_VERSION`, default `1.31.0`).
