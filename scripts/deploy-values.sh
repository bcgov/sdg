#!/usr/bin/env bash
# Values the deploy workflow passes to charts/sdg (DEVELOPER.md, Workflows), derived from the environment
# so reusable-deploy.yml, charts-test.sh and deploy-values.test.sh share one computation.  No cluster access.
#
#   values   print a values file: images, host, Keycloak and Vault settings
#   outputs  print release=, url=, notify_url= and values_file= lines (for $GITHUB_OUTPUT)
#
# Environment (all validated; anything unexpected fails instead of reaching the YAML):
#   TARGET               PR number, test or prod                 REPOSITORY  owner/name (github.repository)
#   ENVIRONMENT          '' (PRs), test or prod                  TAG         image tag
#   OC_NAMESPACE         <plate>-dev|test|prod|tools             OC_SERVER   https://api.<cluster>.<domain>:6443
#   KEYCLOAK_ISSUER_URL  https:// URL                            KEYCLOAK_CLIENT_ID
#   VAULT_SECRET_PATH    optional; default <plate>-nonprod/portal-api (<plate>-prod/portal-api for prod)
#   OBSERVABILITY        optional; "true" reports to the observability stack (doc 20): <plate>-tools for PRs and test,
#                        <plate>-prod for prod. Unset or "false" leaves telemetry off.
#   NOTIFICATION_CLIENT_ID  notification-api's own Keycloak client (the audience it accepts)
#   Direct mode (the header calling notification-api from another site). PRs have no GitHub environment, so PR targets
#   read only the NOTIFICATION_PR_* names (repository variables); test and prod read only the unprefixed names
#   (environment variables). GitHub environments inherit repository variables and can't set one empty, so one shared
#   name would carry a PR's localhost origin or test client into TEST. Both optional, comma-separated:
#   NOTIFICATION_PR_CORS_ORIGINS / NOTIFICATION_CORS_ORIGINS  exact origins; http://localhost[:port] only for PRs
#   NOTIFICATION_PR_RELAYING_CLIENT_IDS / NOTIFICATION_RELAYING_CLIENT_IDS  clients relaying user tokens, added to
#                        KEYCLOAK_CLIENT_ID (the portal), which is always one
#   notification-api's Vault path is derived, never overridden: <plate>-nonprod/notification-api for PRs,
#   <plate>-nonprod/notification-api-test for test, <plate>-prod/notification-api for prod.
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
# notification-api's host: one DNS label under the router's wildcard certificate (charts/common common.notifyHost)
notify_host="${release}-notify.apps.${server}"

case "${1:-}" in
  values)
    check TAG '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
    check OC_NAMESPACE '^[a-z0-9]+-(dev|test|prod|tools)$'
    check KEYCLOAK_ISSUER_URL '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$'
    check KEYCLOAK_CLIENT_ID '^[A-Za-z0-9._-]+$'
    check VAULT_SECRET_PATH '^([A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+)?$'
    check OBSERVABILITY '^(true|false)?$'
    check NOTIFICATION_CLIENT_ID '^[A-Za-z0-9._-]+$'
    client_ids='^([A-Za-z0-9._-]+(,[A-Za-z0-9._-]+)*)?$'
    https_origin='https://[a-z0-9.-]+(:[0-9]+)?'
    notification_secret="notification-api"
    if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
      check NOTIFICATION_PR_RELAYING_CLIENT_IDS "$client_ids"
      check NOTIFICATION_PR_CORS_ORIGINS "^((${https_origin}|http://localhost(:[0-9]+)?)(,|$))*$"
      extra_client_ids="${NOTIFICATION_PR_RELAYING_CLIENT_IDS:-}" cors_origins="${NOTIFICATION_PR_CORS_ORIGINS:-}"
    else
      check NOTIFICATION_RELAYING_CLIENT_IDS "$client_ids"
      check NOTIFICATION_CORS_ORIGINS "^((${https_origin})(,|$))*$"
      extra_client_ids="${NOTIFICATION_RELAYING_CLIENT_IDS:-}" cors_origins="${NOTIFICATION_CORS_ORIGINS:-}"
      [ "$TARGET" != test ] || notification_secret="notification-api-test"
    fi
    [[ "$cors_origins" != *, ]] || { echo "Invalid CORS origins: '${cors_origins}' ends with a comma" >&2; exit 1; }
    plate="${OC_NAMESPACE%-*}"
    vault_role="${plate}-$([ "$ENVIRONMENT" = prod ] && echo prod || echo nonprod)"
    observability=''
    if [ "${OBSERVABILITY:-}" = true ]; then
      # Prod reports to its own stack; PRs and test to the shared non-prod stack in tools.
      stack_namespace="${plate}-$([ "$ENVIRONMENT" = prod ] && echo prod || echo tools)"
      environment_label="$([[ "$TARGET" =~ ^[0-9]+$ ]] && echo "pr-${TARGET}" || echo "$TARGET")"
      observability="
  observability:
    collectorHost: \"observability-alloy.${stack_namespace}.svc\"
    scraperNamespace: \"${stack_namespace}\"
    environment: \"${environment_label}\""
    fi
    cat <<EOF
global:
  image:
    registry: "ghcr.io/${repository}"
    tag: "${TAG}"
  host: "${host}"${observability}
portal-api:
  keycloak:
    issuerUrl: "${KEYCLOAK_ISSUER_URL}"
    clientId: "${KEYCLOAK_CLIENT_ID}"
  vault:
    authPath: "auth/k8s-${cluster}"
    role: "${vault_role}"
    secretPath: "${VAULT_SECRET_PATH:-${vault_role}/portal-api}"
    serviceAccountName: "${plate}-vault"
notification-api:
  keycloak:
    issuerUrl: "${KEYCLOAK_ISSUER_URL}"
    clientId: "${NOTIFICATION_CLIENT_ID}"
    relayingClientIds: "${KEYCLOAK_CLIENT_ID}${extra_client_ids:+,${extra_client_ids}}"
  corsAllowedOrigins: "${cors_origins}"
  vault:
    authPath: "auth/k8s-${cluster}"
    role: "${vault_role}"
    secretPath: "${vault_role}/${notification_secret}"
    serviceAccountName: "${plate}-vault"
EOF
    ;;
  outputs)
    echo "release=${release}"
    echo "url=https://${host}"
    echo "notify_url=https://${notify_host}"
    echo "values_file=charts/sdg/values-${ENVIRONMENT:-pr}.yaml"
    ;;
  *)
    echo "Usage: $0 values|outputs" >&2
    exit 1
    ;;
esac
