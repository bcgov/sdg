#!/usr/bin/env bash
# Lints and unit-tests the Helm charts (charts/README.md).
# Builds each chart's file:// dependencies (leaf charts before the sdg umbrella, which packages them), then runs
# `helm lint` with the values the charts require, the helm-unittest suites in each chart's tests/, and kubeconform
# on the rendered umbrella (Kubernetes schemas plus the PostgresCluster CRD from the datree CRDs-catalog).
#
# Usage: scripts/charts-test.sh
# Needs helm, the unittest plugin (helm plugin install https://github.com/helm-unittest/helm-unittest) and kubeconform.
# KUBERNETES_VERSION selects the schemas (default 1.31.0, OpenShift 4.18).
set -euo pipefail

cd "$(dirname "$0")/../charts"
LEAF_CHARTS=(portal-web portal-api edge postgres valkey)

KUBERNETES_VERSION="${KUBERNETES_VERSION:-1.31.0}"

if ! helm unittest --help >/dev/null 2>&1; then
  echo "The helm unittest plugin is missing: helm plugin install https://github.com/helm-unittest/helm-unittest" >&2
  exit 1
fi
command -v kubeconform >/dev/null || { echo "kubeconform is missing: https://github.com/yannh/kubeconform" >&2; exit 1; }

# The deploy workflow's values come from this script; its own tests run first
../scripts/deploy-values.test.sh

# Values every required field needs, shaped for the umbrella; leaf charts get the same keys without the prefix.
LINT_GLOBALS=(--set global.image.registry=ghcr.io/example/sdg --set global.image.tag=lint --set global.host=sdg.example.com)
lint_values() {
  local prefix="$1"
  echo "${LINT_GLOBALS[@]}" \
    --set "${prefix}keycloak.issuerUrl=https://keycloak.example.com/realms/portal" \
    --set "${prefix}keycloak.clientId=portal" \
    --set "${prefix}vault.role=example-nonprod" \
    --set "${prefix}vault.secretPath=example-nonprod/portal-api" \
    --set "${prefix}vault.serviceAccountName=example-vault"
}

for chart in "${LEAF_CHARTS[@]}" sdg; do
  helm dependency build "$chart" >/dev/null
done

for chart in "${LEAF_CHARTS[@]}"; do
  # shellcheck disable=SC2046 # word splitting of the --set flags is intended
  helm lint --strict "$chart" $(lint_values "")
done
# shellcheck disable=SC2046
helm lint --strict sdg $(lint_values "portal-api.")

helm unittest --strict "${LEAF_CHARTS[@]}" sdg

# helm-unittest can't select a disabled subchart's templates, so the umbrella condition is checked here.
# shellcheck disable=SC2046
if helm template sdg sdg $(lint_values "portal-api.") --set valkey.enabled=false | grep -q 'app.kubernetes.io/name: valkey'; then
  echo "FAIL: sdg with valkey.enabled=false still renders valkey resources" >&2
  exit 1
fi
echo "PASS: a disabled subchart renders nothing"

validate() {
  kubeconform -strict -summary \
    -kubernetes-version "$KUBERNETES_VERSION" \
    -schema-location default \
    -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
}

# shellcheck disable=SC2046
helm template sdg sdg $(lint_values "portal-api.") | validate

# What reusable-deploy.yml installs: values-<env>.yaml plus scripts/deploy-values.sh output (DEVELOPER.md, Workflows).
# expect_rendered <env> <manifests> <grep -E pattern> <description>
expect_rendered() {
  if grep -qE -- "$3" <<< "$2"; then echo "PASS: $1 $4"
  else echo "FAIL: $1 $4" >&2; exit 1; fi
}
for env in pr test prod; do
  case "$env" in
    pr) target=12 environment='' namespace=example-dev ;;
    *) target="$env" environment="$env" namespace="example-${env}" ;;
  esac
  deploy_env=(TARGET="$target" ENVIRONMENT="$environment" TAG=0123abc REPOSITORY=example/sdg OC_NAMESPACE="$namespace"
    OC_SERVER=https://api.gold.devops.gov.bc.ca:6443 KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal
    KEYCLOAK_CLIENT_ID=portal VAULT_SECRET_PATH='')
  outputs="$(env "${deploy_env[@]}" ../scripts/deploy-values.sh outputs)"
  release="$(sed -n 's/^release=//p' <<< "$outputs")"
  values_file="../$(sed -n 's/^values_file=//p' <<< "$outputs")"
  manifests="$(helm template "$release" sdg -f "$values_file" -f <(env "${deploy_env[@]}" ../scripts/deploy-values.sh values))"
  validate <<< "$manifests"
  expect_rendered "$env" "$manifests" "image: ghcr.io/example/sdg/portal-api:0123abc" "deploys the tagged GHCR images"
  expect_rendered "$env" "$manifests" "host: \"?${release}\.apps\.gold\.devops\.gov\.bc\.ca" "routes <release>.<apps domain>"
  expect_rendered "$env" "$manifests" 'vault.hashicorp.com/auth-path: "?auth/k8s-gold' "uses the cluster's Vault auth path"
  case "$env" in
    pr) storage=256Mi wal=64MB keep=16MB ;;
    test) storage=384Mi wal=96MB keep=32MB ;;
    prod) storage=1Gi wal=256MB keep='' ;;
  esac
  expect_rendered "$env" "$manifests" "storage: ${storage}" "sizes Postgres at ${storage}"
  expect_rendered "$env" "$manifests" "max_wal_size: ${wal}" "caps WAL at ${wal}"
  # Postgres keeps max(max_wal_size, wal_keep_size); prod keeps Patroni's 128MB standby reserve
  [ -z "$keep" ] || expect_rendered "$env" "$manifests" "wal_keep_size: ${keep}" "keeps ${keep} of WAL for standbys"
  # PR databases are throwaway: no pgBackRest repo, sidecars or backup Jobs
  if [ "$env" = pr ]; then
    if grep -q 'pgbackrest:' <<< "$manifests"; then echo "FAIL: pr renders pgBackRest" >&2; exit 1; fi
    echo "PASS: pr runs Postgres without pgBackRest"
  else
    expect_rendered "$env" "$manifests" 'pgbackrest:' "backs Postgres up with pgBackRest"
  fi
done
