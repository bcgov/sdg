# Helm charts

Deploy the portal to Kubernetes/OpenShift. Deploy workflows: DEVELOPER.md, Workflows.

| Chart           | Deploys                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `common`        | Library: names (`<release>-<chart>`), labels, image refs, restricted-SCC security contexts                |
| `portal-web`    | The SPA on Caddy (:8080)                                                                                  |
| `portal-api`    | The resident BFF on bff-core (:3000), forwarding to core-api; its sessions migration as initContainer     |
| `admin-api`     | The administrators' BFF on bff-core (:3000, the admin host's `/api`); its sessions migration likewise     |
| `core-api`      | The NestJS service owning the business rules (:3000; only the forwarders reach it), with the migrator     |
| `edge`          | Caddy + Coraza WAF (:3000; metrics :3003 on `<release>-edge-metrics`) and the Ingress                     |
| `postgres`      | A Crunchy PGO `PostgresCluster` (PostgreSQL 17, PostGIS 3.5)                                              |
| `sdg`           | Umbrella: all of the above in one release (`<chart>.enabled` toggles each)                                |
| `observability` | Separate release: Grafana, Prometheus, Loki, Tempo and Alloy in `<plate>-tools` / `<plate>-prod` (doc 20) |

Only standard Kubernetes objects are used, apart from Crunchy's `PostgresCluster` and the Vault Agent annotations. The edge Ingress carries `route.openshift.io/termination: edge`, so OpenShift creates an edge-TLS Route from it, and `haproxy.router.openshift.io/disable_cookies: "true"`, so the router sets no sticky-session cookie (the edge is stateless).

## Prerequisites

- The Crunchy Postgres operator (PGO v5) watching the namespace.
- A Vault KV v2 secret for each BFF (`<role>/portal-api`, `<role>/admin-api`) holding `SESSION_SECRET` (≥ 32 chars, e.g. `openssl rand -base64 48`) and its client's `KEYCLOAK_CLIENT_SECRET`, a Vault role that can read them, and the service account that role trusts (BC Gov: `<plate>-vault`). Values must not contain `'` or newlines.
- Images `portal-web`, `portal-api`, `admin-api`, `core-api`, `database` and `edge` pushed as `<registry>/<name>:<tag>`.

## Install

```sh
helm dependency build charts/portal-web   # likewise portal-api, admin-api, core-api, edge, postgres, then:
helm dependency build charts/sdg
helm upgrade --install sdg-12 charts/sdg -n abc123-dev \
  --set global.image.registry=ghcr.io/<owner>/sdg \
  --set global.image.tag=12 \
  --set global.host=sdg-12.apps.silver.devops.gov.bc.ca \
  --set global.adminHost=sdg-12-admin.apps.silver.devops.gov.bc.ca \
  --set portal-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set portal-api.keycloak.clientId=<client> \
  --set portal-api.vault.role=abc123-nonprod \
  --set portal-api.vault.secretPath=abc123-nonprod/portal-api \
  --set portal-api.vault.serviceAccountName=abc123-vault \
  --set admin-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set admin-api.keycloak.clientId=<admin client> \
  --set admin-api.vault.role=abc123-nonprod \
  --set admin-api.vault.secretPath=abc123-nonprod/admin-api \
  --set admin-api.vault.serviceAccountName=abc123-vault \
  --set core-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set core-api.keycloak.portalClientId=<client> \
  --set core-api.keycloak.adminClientId=<admin client>
```

core-api needs no secret: it only verifies the access tokens the forwarders pass on. `core-api.keycloak.adminClientId` names admin-api's client; left empty, no admin-client token is accepted. The umbrella points the edge's `upstreams.adminApi` at `<release>-admin-api`, so the admin host's `/api` reaches admin-api.

Without Vault, create a Secret with `SESSION_SECRET` and `KEYCLOAK_CLIENT_SECRET` and pass `--set portal-api.vault.enabled=false --set portal-api.existingSecret=<name>` (likewise for `admin-api`).

Environment sizes live in `charts/sdg/values-{pr,test,prod}.yaml`. PR environments are throwaway: `postgres.backups.enabled: false` (no pgBackRest), smaller requests and `strategy: { type: Recreate }` on portal-web, portal-api, admin-api, core-api and edge, so a PR takes about 110m CPU, 630Mi memory and 256Mi of PVC. New service charts such as core-api and admin-api default to PR-level requests (20m / 128Mi), which TEST and PROD inherit. `postgres.parameters` go to Patroni; Postgres keeps about `max(max_wal_size, wal_keep_size)` of WAL, so keep both at about a quarter of `postgres.instances.storage` or less (`max_wal_size` 256MB default, 96MB TEST, 64MB PR; `wal_keep_size` Patroni's 128MB, 32MB TEST, 16MB PR).

On first install portal-api, admin-api and core-api pods wait (`CreateContainerConfigError`) until PGO has created the user Secrets; their migrate initContainers then retry until the database accepts connections.

The postgres chart creates one database, `portal`, and one login per service (`postgres.users`: `core`, `portal`, `admin`). PGO writes each login's credentials to Secret `<release>-postgres-pguser-<login>`. Its init SQL gives each login a schema of its own name, which Postgres's default `search_path` resolves first, so no login can read another's tables; nothing lives in `public`. The database migrator (`database` image) applies the `core` schema as the `core` login, as core-api's initContainer; portal-api's own image (`node dist/migrate.js`) applies bff-core's sessions migrations to the `portal` schema as the `portal` login, as portal-api's initContainer, and schedules that login's `portal-prune-expired-sessions` job; admin-api's image does the same in the `admin` schema as the `admin` login (`admin-prune-expired-sessions`). portal-api and admin-api reach core-api at `<chart>.coreApiUrl` (default `http://<release>-core-api:3000`). The chart also preloads pg_cron (`postgres.parameters`); the init SQL installs it, grants the `portal` and `admin` logins its `cron` schema so they can schedule their own jobs, and schedules `purge-cron-run-details` as the superuser (`SELECT jobname, schedule FROM cron.job;`). PGO runs the init SQL only when it creates a cluster, so a change to it reaches an existing environment only by deleting the `PostgresCluster` and its PVCs, which a person does (never the deploy workflow); the next deploy recreates the cluster. compose mirrors the init SQL in `packages/database/dev-postgres/init-roles.sql`; change both together.

## Observability

`charts/observability` is installed on its own as release `observability` by `.github/workflows/observability.yml`: in `<plate>-tools` (`values-tools.yaml`; collects from `<plate>-dev` and `<plate>-test`) and in `<plate>-prod` (`values-prod.yaml`; its own namespace only). Its configs are `charts/observability/files/`, shared with `compose.observability.yaml`. Only Grafana has an Ingress, with Keycloak login; users need the `admin`, `editor` or `viewer` client role.

The app charts report to it through `global.observability` (`collectorHost`, `scraperNamespace`, `environment`), which `scripts/deploy-values.sh` fills in when the `OBSERVABILITY` variable is `true`. Left empty, nothing is rendered. Set, portal-api, admin-api and core-api get `OTEL_*` env, the edge turns `/collect` on, their pods get `sdg.gov.bc.ca/scrape*` annotations and a NetworkPolicy rule for the stack's Alloy, and Alloy may scrape them. Alloy's read-only pod discovery (Role and RoleBinding `observability-discovery`) is made once per namespace by a person with `scripts/setup-openshift.sh --observability --apply`; the deploy account can't manage RBAC.

## Where configuration lives

| Kind                                                              | Where                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Plain config (`APP_URL`, Keycloak issuer/client id, log level, …) | values → ConfigMap                                          |
| `DATABASE_URL`                                                    | Secret `<release>-postgres-pguser-<login>` (created by PGO) |
| `SESSION_SECRET`, `KEYCLOAK_CLIENT_SECRET`                        | Vault → `/vault/secrets/<app>.env` → `node --env-file`      |

## Test

```sh
helm plugin install https://github.com/helm-unittest/helm-unittest   # once (Helm 4: add --verify=false)
brew install kubeconform                                             # once
pnpm test:charts
```

`scripts/charts-test.sh` builds dependencies, runs `helm lint --strict` on every chart and the helm-unittest suites in each chart's `tests/`, checks that a disabled subchart renders nothing, and validates the rendered umbrella with kubeconform (`KUBERNETES_VERSION`, default `1.31.0`).
