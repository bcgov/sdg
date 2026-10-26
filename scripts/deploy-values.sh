#!/usr/bin/env bash
# Values the deploy workflow passes to charts/sdg (DEVELOPER.md, Workflows), derived from the environment
# so reusable-deploy.yml, charts-test.sh and deploy-values.test.sh share one computation.  No cluster access.
#
#   values   print a values file: images, host, Keycloak and Vault settings
#   outputs  print release=, url= and values_file= lines (for $GITHUB_OUTPUT)
#
# Environment (all validated; anything unexpected fails instead of reaching the YAML):
#   TARGET               PR number, test or prod                 REPOSITORY  owner/name (github.repository)
#   ENVIRONMENT          '' (PRs), test or prod                  TAG         image tag
#   OC_NAMESPACE         <plate>-dev|test|prod|tools             OC_SERVER   https://api.<cluster>.<domain>:6443
#   KEYCLOAK_ISSUER_URL  https:// URL                            KEYCLOAK_CLIENT_ID
#   VAULT_SECRET_PATH    optional; default <plate>-nonprod/portal-api (<plate>-prod/portal-api for prod)
# `outputs` needs only TARGET, ENVIRONMENT, REPOSITORY and OC_SERVER.
#
# Usage: scripts/deploy-values.sh values|outputs
set -euo pipefail

# check <name> <regex>: fail naming the variable when its value doesn't match
check() {
  local value="${!1-}"
  [[ "$value" =~ $2 ]] || { echo "Invalid ${1}: '${value}'" >&2; exit 1; }
}

check TARGET '^([0-9]+|test|prod)$'
check ENVIRONMENT '^(test|prod)?$'
check REPOSITORY '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
check OC_SERVER '^https://api\.([a-z0-9-]+)\.([a-z0-9.-]+):6443$'

# shellcheck disable=SC2153 # REPOSITORY comes from the environment
repository="$(tr "[:upper:]" "[:lower:]" <<< "$REPOSITORY")"
release="${repository#*/}-${TARGET}"
[[ "$release" =~ ^[a-z0-9]([a-z0-9-]{0,51}[a-z0-9])?$ ]] || { echo "Invalid release name: '${release}'" >&2; exit 1; }
# https://api.<cluster>.<domain>:6443 → apps.<cluster>.<domain>; the cluster also names Vault's auth path
server="${OC_SERVER#https://api.}"
server="${server%:6443}"
cluster="${server%%.*}"
host="${release}.apps.${server}"

case "${1:-}" in
  values)
    check TAG '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
    check OC_NAMESPACE '^[a-z0-9]+-(dev|test|prod|tools)$'
    check KEYCLOAK_ISSUER_URL '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'
    check KEYCLOAK_CLIENT_ID '^[A-Za-z0-9._-]+$'
    check VAULT_SECRET_PATH '^([A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+)?$'
    plate="${OC_NAMESPACE%-*}"
    vault_role="${plate}-$([ "$ENVIRONMENT" = prod ] && echo prod || echo nonprod)"
    cat <<EOF
global:
  image:
    registry: "ghcr.io/${repository}"
    tag: "${TAG}"
  host: "${host}"
portal-api:
  keycloak:
    issuerUrl: "${KEYCLOAK_ISSUER_URL}"
    clientId: "${KEYCLOAK_CLIENT_ID}"
  vault:
    authPath: "auth/k8s-${cluster}"
    role: "${vault_role}"
    secretPath: "${VAULT_SECRET_PATH:-${vault_role}/portal-api}"
    serviceAccountName: "${plate}-vault"
EOF
    ;;
  outputs)
    echo "release=${release}"
    echo "url=https://${host}"
    echo "values_file=charts/sdg/values-${ENVIRONMENT:-pr}.yaml"
    ;;
  *)
    echo "Usage: $0 values|outputs" >&2
    exit 1
    ;;
esac
