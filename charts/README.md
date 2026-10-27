# Helm charts

Deploy the portal to Kubernetes/OpenShift. Deploy workflows: DEVELOPER.md, Workflows.

| Chart        | Deploys                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `common`     | Library: names (`<release>-<chart>`), labels, image refs, restricted-SCC security contexts |
| `portal-web` | The SPA on Caddy (:8080)                                                                   |
| `portal-api` | The NestJS BFF (:3000), with the `portal-database` migrator as an initContainer            |
| `edge`       | Caddy + Coraza WAF (:3000; metrics :3003 on `<release>-edge-metrics`) and the Ingress      |
| `postgres`   | A Crunchy PGO `PostgresCluster` (PostgreSQL 17, PostGIS 3.5)                               |
| `sdg`        | Umbrella: all of the above in one release (`<chart>.enabled` toggles each)                 |

Only standard Kubernetes objects are used, apart from Crunchy's `PostgresCluster` and the Vault Agent annotations. The edge Ingress carries `route.openshift.io/termination: edge`, so OpenShift creates an edge-TLS Route from it.

## Prerequisites

- The Crunchy Postgres operator (PGO v5) watching the namespace.
- A Vault KV v2 secret holding `SESSION_SECRET` (≥ 32 chars, e.g. `openssl rand -base64 48`) and `KEYCLOAK_CLIENT_SECRET`, a Vault role that can read it, and the service account that role trusts (BC Gov: `<plate>-vault`). Values must not contain `'` or newlines.
- Images `portal-web`, `portal-api`, `portal-database` and `edge` pushed as `<registry>/<name>:<tag>`.

## Install

```sh
helm dependency build charts/portal-web   # likewise portal-api, edge, postgres, then:
helm dependency build charts/sdg
helm upgrade --install sdg-12 charts/sdg -n abc123-dev \
  --set global.image.registry=ghcr.io/<owner>/sdg \
  --set global.image.tag=12 \
  --set global.host=sdg-12.apps.silver.devops.gov.bc.ca \
  --set portal-api.keycloak.issuerUrl=https://<keycloak>/realms/<realm> \
  --set portal-api.keycloak.clientId=<client> \
  --set portal-api.vault.role=abc123-nonprod \
  --set portal-api.vault.secretPath=abc123-nonprod/portal-api \
  --set portal-api.vault.serviceAccountName=abc123-vault
```

Without Vault, create a Secret with `SESSION_SECRET` and `KEYCLOAK_CLIENT_SECRET` and pass `--set portal-api.vault.enabled=false --set portal-api.existingSecret=<name>`.

Environment sizes live in `charts/sdg/values-{pr,test,prod}.yaml`. PR environments are throwaway: `postgres.backups.enabled: false` (no pgBackRest), smaller requests and `strategy: { type: Recreate }` on portal-web, portal-api and edge, so a PR takes about 70m CPU, 370Mi memory and 256Mi of PVC. `postgres.parameters` go to Patroni; Postgres keeps about `max(max_wal_size, wal_keep_size)` of WAL, so keep both at about a quarter of `postgres.instances.storage` or less (`max_wal_size` 256MB default, 96MB TEST, 64MB PR; `wal_keep_size` Patroni's 128MB, 32MB TEST, 16MB PR).

On first install portal-api pods wait (`CreateContainerConfigError`) until PGO has created the user Secret; the migrator then retries until the database accepts connections.

The postgres chart preloads pg_cron (`postgres.parameters`), and its init SQL installs the extension and grants the app user the `cron` schema. portal-database's migrations then schedule the jobs as that user, for example deleting expired sessions every 15 minutes (`SELECT jobname, schedule FROM cron.job;`). PGO runs the init SQL only when it creates a cluster. A cluster created before this was added needs two steps by hand, and its migrations fail until both are done. First, after the parameter change rolls out, check `SHOW shared_preload_libraries;` and restart the cluster if pg_cron isn't listed yet (`patronictl restart`). Second, as superuser on the primary, run `psql -d portal -c 'CREATE EXTENSION IF NOT EXISTS pg_cron; GRANT USAGE ON SCHEMA cron TO portal;'`.

## Where configuration lives

| Kind                                                              | Where                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Plain config (`APP_URL`, Keycloak issuer/client id, log level, …) | values → ConfigMap                                          |
| `DATABASE_URL`                                                    | Secret `<release>-postgres-pguser-portal` (created by PGO)  |
| `SESSION_SECRET`, `KEYCLOAK_CLIENT_SECRET`                        | Vault → `/vault/secrets/portal-api.env` → `node --env-file` |

## Test

```sh
helm plugin install https://github.com/helm-unittest/helm-unittest   # once (Helm 4: add --verify=false)
brew install kubeconform                                             # once
pnpm test:charts
```

`scripts/charts-test.sh` builds dependencies, runs `helm lint --strict` on every chart and the helm-unittest suites in each chart's `tests/`, checks that a disabled subchart renders nothing, and validates the rendered umbrella with kubeconform (`KUBERNETES_VERSION`, default `1.31.0`).
