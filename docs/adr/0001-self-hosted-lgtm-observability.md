# ADR 0001: Self-hosted Grafana LGTM stack, with Prometheus, for the portal's telemetry

- **Status:** Proposed
- **Date:** 2026-11-02
- **Deciders:** SDG portal team
- **Product team:** SDG portal
- **Related:** `.mdd/docs/20-observability-lgtm.md`, `charts/observability`, `compose.observability.yaml`

## Context

portal-api already exposes Prometheus metrics (`/metrics`) and writes pino JSON logs to stdout, and the edge (Caddy)
exposes metrics on :3003. Nothing collects them: the only monitoring is the platform's Sysdig email alerts on pod health
(`monitoring/alerts/`). There are no traces, and nothing records browser errors.

Constraints on BC Gov Gold (plate d62e77):

- PR environments share `d62e77-dev` with another team and have almost no spare quota: each PR takes about 70m CPU and
  370Mi memory (doc 18). A collector or a stack per PR does not fit.
- There is no node-level log access, so logs must be pushed by the apps rather than read from container log files.
- The NetworkPolicies admit only each pod's one caller, and the edge's CSP allows `connect-src 'self'`.

## Decision

We will run Grafana, Loki, Tempo and Prometheus (in place of Mimir), with Grafana Alloy as the only collector, as one
shared non-prod stack in `d62e77-tools` and a separate stack in `d62e77-prod`. Locally it runs as a compose override.
portal-api sends traces and logs over OTLP with the OpenTelemetry Node SDK; Alloy scrapes metrics across namespaces;
portal-web sends browser telemetry with Grafana Faro to a same-origin `/collect`, which the edge proxies to Alloy.
Every piece is off unless configured.

## Options considered

### Option 1: Shared stack in tools plus a prod stack (chosen)

- Pros: PR and test environments pay no quota for telemetry; prod telemetry stays in prod, and a busy dev environment
  can't push prod data out of retention or take prod visibility down; one chart serves both stacks.
- Cons: traffic across namespaces needs NetworkPolicies on both sides and a read-only Role per source namespace;
  two stacks to run.

### Option 2: One stack in tools for every environment, prod included

- Pros: one stack, one Grafana.
- Cons: prod visibility depends on non-prod load and on the tools namespace; prod data lives with dev data.

### Option 3: A stack per environment (in the umbrella chart)

- Pros: no cross-namespace traffic.
- Cons: does not fit PR quotas (doc 18).

### Option 4: Mimir instead of Prometheus

- Pros: horizontally scalable, multi-tenant, object storage.
- Cons: needs object storage and several components; far more than one portal's metrics need.

## Consequences

- **Positive:** metrics, logs, traces and browser errors in one Grafana, linked by `trace_id`; the existing `/metrics`
  and pino logs are reused unchanged; environments without the stack are unaffected.
- **Negative:** single-replica, filesystem-backed components (no HA; data is lost if a PVC is lost); the tools namespace has
  1Gi of PVC in total, so non-prod keeps only metrics and logs on volumes and traces are lost on a restart; the public `/collect` endpoint is a new abuse surface, mitigated
  by a 64 KiB body cap at the edge, Alloy's rate limit and fixed Loki labels.
- **Follow-up work:** a Keycloak client for Grafana, Vault secrets `<plate>-{nonprod,prod}/grafana`, a `tools` GitHub
  environment, then `OBSERVABILITY=true` to turn on reporting from the app deploys.

## Notes

Revisit if retention or volume outgrows the filesystem backends (move Loki and Tempo to object storage) or if more
products share the stack (consider Mimir and multi-tenancy).
